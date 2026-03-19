import { z } from "zod";

import {
  createHtmlPageLoader,
  readCanonicalUrl,
  withHtmlDocument,
} from "#app/web/page.ts";
import {
  absoluteHttpUrlSchema,
  ensureTrailingNewline,
  formatInputIssues,
  isSameOriginUrl,
  normalizeAbsoluteUrl,
  normalizeWhitespace,
  readOptionalString,
  splitTokens,
} from "#app/web/shared.ts";

const linkKinds = ["same-origin", "fragment", "external"] as const;

type WebPageLinkKind = (typeof linkKinds)[number];

type WebPageLinksRequest = Readonly<{
  url: string;
  timeoutMs: number;
  sameOriginOnly: boolean;
}>;

type WebPageLink = Readonly<{
  kind: WebPageLinkKind;
  url: string;
  texts: readonly string[];
  rel: readonly string[];
  targets: readonly string[];
  occurrences: number;
}>;

type WebPageLinks = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | undefined;
  sameOriginOnly: boolean;
  links: readonly WebPageLink[];
}>;

type WebPageLinkReader = Readonly<{
  read: (request: WebPageLinksRequest) => Promise<WebPageLinks>;
}>;

export class WebPageLinksError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebPageLinksError";
  }
}

const linksCommandSchema = z.object({
  options: z.object({
    json: z.boolean(),
    sameOrigin: z.boolean(),
    timeout: z.coerce
      .number()
      .int("Timeout must be an integer.")
      .positive("Timeout must be greater than 0."),
  }),
  url: absoluteHttpUrlSchema,
});

const parseLinksCommandInput = (input: unknown) => {
  const result = linksCommandSchema.safeParse(input);

  if (!result.success) {
    throw new WebPageLinksError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const unsupportedHrefPattern = /^(?:javascript:|mailto:|tel:|data:)/iu;

const kindOrder = new Map<WebPageLinkKind, number>([
  ["same-origin", 0],
  ["fragment", 1],
  ["external", 2],
]);

const readLinkText = (element: HTMLAnchorElement) => {
  const text = normalizeWhitespace(element.textContent ?? "");

  if (text !== "") {
    return text;
  }

  return (
    readOptionalString(element.getAttribute("aria-label")) ??
    readOptionalString(element.getAttribute("title"))
  );
};

const resolveLink = (href: string, finalUrl: string) => {
  if (unsupportedHrefPattern.test(href)) {
    return undefined;
  }

  let resolvedUrl: URL;

  try {
    resolvedUrl = new URL(href, finalUrl);
  } catch {
    return undefined;
  }

  const kind: WebPageLinkKind = href.startsWith("#")
    ? "fragment"
    : isSameOriginUrl(resolvedUrl.toString(), finalUrl)
      ? "same-origin"
      : "external";

  return {
    kind,
    url: normalizeAbsoluteUrl(resolvedUrl.toString(), {
      keepHash: kind === "fragment",
    }),
  };
};

const appendUnique = (items: string[], item: string | undefined) => {
  if (item === undefined || items.includes(item)) {
    return;
  }

  items.push(item);
  items.sort((left, right) => left.localeCompare(right));
};

const extractLinks = (
  document: Document,
  finalUrl: string,
  sameOriginOnly: boolean,
) => {
  const groupedLinks = new Map<
    string,
    {
      kind: WebPageLinkKind;
      url: string;
      texts: string[];
      rel: string[];
      targets: string[];
      occurrences: number;
    }
  >();

  for (const element of Array.from(
    document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  )) {
    const href = element.getAttribute("href")?.trim();

    if (href === undefined || href === "") {
      continue;
    }

    const resolvedLink = resolveLink(href, finalUrl);

    if (resolvedLink === undefined) {
      continue;
    }

    if (
      sameOriginOnly &&
      resolvedLink.kind !== "same-origin" &&
      resolvedLink.kind !== "fragment"
    ) {
      continue;
    }

    const key = `${resolvedLink.kind}:${resolvedLink.url}`;
    const existingLink = groupedLinks.get(key);

    if (existingLink === undefined) {
      const texts: string[] = [];
      const rel = splitTokens(element.getAttribute("rel"));
      const targets: string[] = [];

      appendUnique(texts, readLinkText(element));
      appendUnique(targets, readOptionalString(element.getAttribute("target")));

      groupedLinks.set(key, {
        kind: resolvedLink.kind,
        url: resolvedLink.url,
        texts,
        rel,
        targets,
        occurrences: 1,
      });
      continue;
    }

    appendUnique(existingLink.texts, readLinkText(element));

    for (const relValue of splitTokens(element.getAttribute("rel"))) {
      appendUnique(existingLink.rel, relValue);
    }

    appendUnique(
      existingLink.targets,
      readOptionalString(element.getAttribute("target")),
    );
    existingLink.occurrences += 1;
  }

  return [...groupedLinks.values()]
    .sort((left, right) => {
      const kindDifference =
        (kindOrder.get(left.kind) ?? Number.POSITIVE_INFINITY) -
        (kindOrder.get(right.kind) ?? Number.POSITIVE_INFINITY);

      if (kindDifference !== 0) {
        return kindDifference;
      }

      return left.url.localeCompare(right.url);
    })
    .map((link) => {
      return {
        kind: link.kind,
        url: link.url,
        texts: link.texts,
        rel: link.rel,
        targets: link.targets,
        occurrences: link.occurrences,
      } satisfies WebPageLink;
    });
};

export const formatWebPageLinks = (links: WebPageLinks, json: boolean) => {
  if (json) {
    return `${JSON.stringify(links, null, 2)}\n`;
  }

  if (links.links.length === 0) {
    return ensureTrailingNewline(
      [
        `Requested URL: ${links.requestedUrl}`,
        `Final URL: ${links.finalUrl}`,
        `Canonical URL: ${links.canonicalUrl ?? ""}`.trimEnd(),
        `Same-origin only: ${links.sameOriginOnly ? "yes" : "no"}`,
        "",
        "No supported links found.",
      ].join("\n"),
    );
  }

  return ensureTrailingNewline(
    [
      `Requested URL: ${links.requestedUrl}`,
      `Final URL: ${links.finalUrl}`,
      `Canonical URL: ${links.canonicalUrl ?? ""}`.trimEnd(),
      `Same-origin only: ${links.sameOriginOnly ? "yes" : "no"}`,
      "",
      ...links.links.flatMap((link, index) => {
        const lines = [`${index + 1}. [${link.kind}] ${link.url}`];

        if (link.texts.length > 0) {
          lines.push(`   texts: ${link.texts.join(" | ")}`);
        }

        if (link.rel.length > 0) {
          lines.push(`   rel: ${link.rel.join(", ")}`);
        }

        if (link.targets.length > 0) {
          lines.push(`   targets: ${link.targets.join(", ")}`);
        }

        lines.push(`   occurrences: ${link.occurrences}`);

        return lines;
      }),
    ].join("\n"),
  );
};

export const createWebPageLinkReader = (dependencies: {
  fetchImplementation: typeof fetch;
  userAgent?: string;
}) => {
  const htmlPageLoader = createHtmlPageLoader(dependencies);

  return {
    read: async (request: WebPageLinksRequest) => {
      try {
        const page = await htmlPageLoader.load(request);

        return withHtmlDocument(page.html, page.finalUrl, (document) => {
          return {
            requestedUrl: page.requestedUrl,
            finalUrl: page.finalUrl,
            canonicalUrl: readCanonicalUrl(document, page.finalUrl),
            sameOriginOnly: request.sameOriginOnly,
            links: extractLinks(
              document,
              page.finalUrl,
              request.sameOriginOnly,
            ),
          } satisfies WebPageLinks;
        });
      } catch (error: unknown) {
        throw new WebPageLinksError(
          error instanceof Error ? error.message : "Web request failed.",
        );
      }
    },
  } satisfies WebPageLinkReader;
};

export const runWebLinksCommand = async (
  input: Readonly<{
    url: string;
    options: Record<string, unknown>;
  }>,
  dependencies: {
    webPageLinkReader: WebPageLinkReader;
  },
) => {
  const validatedInput = parseLinksCommandInput(input);
  const links = await dependencies.webPageLinkReader.read({
    url: validatedInput.url,
    timeoutMs: validatedInput.options.timeout,
    sameOriginOnly: validatedInput.options.sameOrigin,
  });

  return formatWebPageLinks(links, validatedInput.options.json);
};
