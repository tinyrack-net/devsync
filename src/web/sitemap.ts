import type { Command } from "commander";
import { JSDOM } from "jsdom";
import { z } from "zod";

import {
  absoluteHttpUrlSchema,
  createRequestHeaders,
  defaultWebRequestTimeoutMs,
  ensureTrailingNewline,
  fetchWithTimeout,
  formatInputIssues,
  isSameOriginUrl,
  normalizeAbsoluteUrl,
} from "#app/web/shared.ts";

const defaultSitemapConcurrency = "4";

type WebSitemapRequest = Readonly<{
  url: string;
  timeoutMs: number;
  sameOriginOnly: boolean;
  concurrency: number;
}>;

type SitemapUrlEntry = Readonly<{
  url: string;
  lastModified: string | undefined;
}>;

type WebSitemap = Readonly<{
  requestedUrl: string;
  sitemapUrls: readonly string[];
  sameOriginOnly: boolean;
  urls: readonly SitemapUrlEntry[];
}>;

type WebSitemapReader = Readonly<{
  read: (request: WebSitemapRequest) => Promise<WebSitemap>;
}>;

export class WebSitemapError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebSitemapError";
  }
}

const sitemapCommandSchema = z.object({
  options: z.object({
    concurrency: z.coerce
      .number()
      .int("Concurrency must be an integer.")
      .positive("Concurrency must be greater than 0."),
    json: z.boolean(),
    sameOrigin: z.boolean(),
    timeout: z.coerce
      .number()
      .int("Timeout must be an integer.")
      .positive("Timeout must be greater than 0."),
  }),
  url: absoluteHttpUrlSchema,
});

const parseSitemapCommandInput = (input: unknown) => {
  const result = sitemapCommandSchema.safeParse(input);

  if (!result.success) {
    throw new WebSitemapError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const isSitemapXmlContentType = (contentType: string) => {
  return contentType.includes("xml") || contentType.includes("text/plain");
};

const readTextResponse = async (request: {
  url: string;
  timeoutMs: number;
  userAgent?: string;
  fetchImplementation: typeof fetch;
  accept: string;
  subject: string;
}) => {
  const response = await fetchWithTimeout({
    url: request.url,
    timeoutMs: request.timeoutMs,
    subject: request.subject,
    fetchImplementation: request.fetchImplementation,
    headers: createRequestHeaders(request.accept, request.userAgent),
  });

  if (!response.ok) {
    throw new Error(
      `${request.subject} failed with ${response.status} ${response.statusText}.`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  return {
    body: await response.text(),
    contentType,
    finalUrl:
      response.url === ""
        ? normalizeAbsoluteUrl(request.url)
        : normalizeAbsoluteUrl(response.url),
  };
};

const parseRobotsSitemapUrls = (robotsText: string, baseUrl: string) => {
  const sitemapUrls = new Set<string>();

  for (const line of robotsText.split(/\r?\n/u)) {
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/iu.exec(line);

    if (match === null) {
      continue;
    }

    const sitemapLocation = match[1];

    if (sitemapLocation === undefined) {
      continue;
    }

    try {
      sitemapUrls.add(
        normalizeAbsoluteUrl(new URL(sitemapLocation, baseUrl).toString()),
      );
    } catch {
      // Ignore invalid sitemap URLs from robots.txt.
    }
  }

  return [...sitemapUrls].sort((left, right) => left.localeCompare(right));
};

const discoverSitemapUrls = async (
  requestUrl: string,
  timeoutMs: number,
  dependencies: {
    fetchImplementation: typeof fetch;
    userAgent?: string;
  },
) => {
  const normalizedRequestUrl = normalizeAbsoluteUrl(requestUrl);
  const parsedRequestUrl = new URL(normalizedRequestUrl);

  if (parsedRequestUrl.pathname.endsWith(".xml")) {
    return [normalizedRequestUrl];
  }

  const robotsUrl = new URL("/robots.txt", parsedRequestUrl).toString();

  try {
    const robotsResponse = await readTextResponse({
      url: robotsUrl,
      timeoutMs,
      fetchImplementation: dependencies.fetchImplementation,
      accept: "text/plain",
      subject: "Robots.txt request",
      ...(dependencies.userAgent === undefined
        ? {}
        : {
            userAgent: dependencies.userAgent,
          }),
    });
    const discoveredSitemapUrls = parseRobotsSitemapUrls(
      robotsResponse.body,
      robotsResponse.finalUrl,
    );

    if (discoveredSitemapUrls.length > 0) {
      return discoveredSitemapUrls;
    }
  } catch {
    // Fall back to /sitemap.xml when robots.txt is unavailable or unhelpful.
  }

  return [new URL("/sitemap.xml", parsedRequestUrl).toString()];
};

const readChildText = (element: Element, childLocalName: string) => {
  for (const child of Array.from(element.children)) {
    if (child.localName === childLocalName) {
      const textContent = child.textContent?.trim();

      return textContent === "" || textContent === undefined
        ? undefined
        : textContent;
    }
  }

  return undefined;
};

const parseSitemapXml = (xml: string, sitemapUrl: string) => {
  const dom = new JSDOM(xml.trim(), {
    contentType: "text/xml",
    url: sitemapUrl,
  });

  try {
    const rootElement = dom.window.document.documentElement;

    if (rootElement.localName === "parsererror") {
      throw new Error("Sitemap XML could not be parsed.");
    }

    if (rootElement.localName === "urlset") {
      const urls: SitemapUrlEntry[] = [];

      for (const child of Array.from(rootElement.children)) {
        if (child.localName !== "url") {
          continue;
        }

        const location = readChildText(child, "loc");

        if (location === undefined) {
          continue;
        }

        try {
          urls.push({
            url: normalizeAbsoluteUrl(new URL(location, sitemapUrl).toString()),
            lastModified: readChildText(child, "lastmod"),
          });
        } catch {
          // Ignore invalid <loc> entries.
        }
      }

      return {
        childSitemaps: [] as string[],
        urls,
      };
    }

    if (rootElement.localName === "sitemapindex") {
      const childSitemaps: string[] = [];

      for (const child of Array.from(rootElement.children)) {
        if (child.localName !== "sitemap") {
          continue;
        }

        const location = readChildText(child, "loc");

        if (location === undefined) {
          continue;
        }

        try {
          childSitemaps.push(
            normalizeAbsoluteUrl(new URL(location, sitemapUrl).toString()),
          );
        } catch {
          // Ignore invalid nested sitemap URLs.
        }
      }

      childSitemaps.sort((left, right) => left.localeCompare(right));

      return {
        childSitemaps,
        urls: [] as SitemapUrlEntry[],
      };
    }

    throw new Error("XML document is not a sitemap or sitemap index.");
  } finally {
    dom.window.close();
  }
};

const readSitemapDocument = async (
  sitemapUrl: string,
  request: WebSitemapRequest,
  dependencies: {
    fetchImplementation: typeof fetch;
    userAgent?: string;
  },
) => {
  const response = await readTextResponse({
    url: sitemapUrl,
    timeoutMs: request.timeoutMs,
    fetchImplementation: dependencies.fetchImplementation,
    accept: "application/xml,text/xml,text/plain",
    subject: "Sitemap request",
    ...(dependencies.userAgent === undefined
      ? {}
      : {
          userAgent: dependencies.userAgent,
        }),
  });

  if (!isSitemapXmlContentType(response.contentType)) {
    throw new Error(
      `Unsupported content type: ${response.contentType || "unknown"}.`,
    );
  }

  return {
    sitemapUrl: response.finalUrl,
    ...parseSitemapXml(response.body, response.finalUrl),
  };
};

const readConcurrent = async <T>(
  items: readonly string[],
  concurrency: number,
  read: (item: string) => Promise<T>,
) => {
  const results: T[] = [];
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex];

      if (item === undefined) {
        return;
      }

      results[currentIndex] = await read(item);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => {
      return runWorker();
    }),
  );

  return results;
};

export const formatWebSitemap = (sitemap: WebSitemap, json: boolean) => {
  if (json) {
    return `${JSON.stringify(sitemap, null, 2)}\n`;
  }

  if (sitemap.urls.length === 0) {
    return ensureTrailingNewline(
      [
        `Requested URL: ${sitemap.requestedUrl}`,
        `Same-origin only: ${sitemap.sameOriginOnly ? "yes" : "no"}`,
        `Sitemap URLs: ${sitemap.sitemapUrls.join(", ")}`,
        "",
        "No sitemap URLs found.",
      ].join("\n"),
    );
  }

  return ensureTrailingNewline(
    [
      `Requested URL: ${sitemap.requestedUrl}`,
      `Same-origin only: ${sitemap.sameOriginOnly ? "yes" : "no"}`,
      `Sitemap URLs: ${sitemap.sitemapUrls.join(", ")}`,
      "",
      ...sitemap.urls.map((entry, index) => {
        const suffix =
          entry.lastModified === undefined
            ? ""
            : ` (lastmod: ${entry.lastModified})`;

        return `${index + 1}. ${entry.url}${suffix}`;
      }),
    ].join("\n"),
  );
};

export const createWebSitemapReader = (dependencies: {
  fetchImplementation: typeof fetch;
  userAgent?: string;
}) => {
  return {
    read: async (request: WebSitemapRequest) => {
      try {
        const requestedUrl = normalizeAbsoluteUrl(request.url);
        const sameOriginUrl = new URL(requestedUrl).origin;
        const seedSitemapUrls = (
          await discoverSitemapUrls(
            request.url,
            request.timeoutMs,
            dependencies,
          )
        )
          .filter((sitemapUrl) => {
            return (
              !request.sameOriginOnly ||
              new URL(sitemapUrl).origin === sameOriginUrl
            );
          })
          .sort((left, right) => left.localeCompare(right));

        if (seedSitemapUrls.length === 0) {
          throw new Error("No sitemap URLs matched the same-origin filter.");
        }

        const queuedSitemapUrls = [...seedSitemapUrls];
        const visitedSitemapUrls = new Set<string>();
        const collectedSitemapUrls = new Set<string>();
        const collectedUrlEntries = new Map<string, SitemapUrlEntry>();

        while (queuedSitemapUrls.length > 0) {
          const batch = queuedSitemapUrls.splice(0, request.concurrency);
          const batchSitemapUrls = [...batch].sort((left, right) => {
            return left.localeCompare(right);
          });
          const sitemapDocuments = await readConcurrent(
            batchSitemapUrls,
            request.concurrency,
            async (sitemapUrl) => {
              visitedSitemapUrls.add(sitemapUrl);
              return readSitemapDocument(sitemapUrl, request, dependencies);
            },
          );

          for (const sitemapDocument of sitemapDocuments) {
            collectedSitemapUrls.add(sitemapDocument.sitemapUrl);

            for (const childSitemapUrl of sitemapDocument.childSitemaps) {
              if (
                request.sameOriginOnly &&
                !isSameOriginUrl(childSitemapUrl, requestedUrl)
              ) {
                continue;
              }

              if (visitedSitemapUrls.has(childSitemapUrl)) {
                continue;
              }

              if (queuedSitemapUrls.includes(childSitemapUrl)) {
                continue;
              }

              queuedSitemapUrls.push(childSitemapUrl);
            }

            for (const entry of sitemapDocument.urls) {
              if (
                request.sameOriginOnly &&
                !isSameOriginUrl(entry.url, requestedUrl)
              ) {
                continue;
              }

              const existingEntry = collectedUrlEntries.get(entry.url);

              if (
                existingEntry === undefined ||
                (existingEntry.lastModified === undefined &&
                  entry.lastModified !== undefined)
              ) {
                collectedUrlEntries.set(entry.url, entry);
              }
            }
          }

          queuedSitemapUrls.sort((left, right) => left.localeCompare(right));
        }

        return {
          requestedUrl,
          sitemapUrls: [...collectedSitemapUrls].sort((left, right) => {
            return left.localeCompare(right);
          }),
          sameOriginOnly: request.sameOriginOnly,
          urls: [...collectedUrlEntries.values()].sort((left, right) => {
            return left.url.localeCompare(right.url);
          }),
        } satisfies WebSitemap;
      } catch (error: unknown) {
        throw new WebSitemapError(
          error instanceof Error ? error.message : "Sitemap request failed.",
        );
      }
    },
  } satisfies WebSitemapReader;
};

export const registerWebSitemapCommand = (
  webCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    webSitemapReader: WebSitemapReader;
  },
) => {
  webCommand
    .command("sitemap")
    .description("Read a sitemap.xml file or discover sitemap URLs for a site")
    .argument("<url>", "Site URL or sitemap XML URL")
    .option("--json", "Print sitemap results as JSON", false)
    .option("--same-origin", "Only include same-origin sitemap URLs", false)
    .option(
      "-c, --concurrency <number>",
      "Maximum number of sitemap requests to run at once",
      defaultSitemapConcurrency,
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultWebRequestTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseSitemapCommandInput({ options, url });
      const sitemap = await dependencies.webSitemapReader.read({
        url: validatedInput.url,
        timeoutMs: validatedInput.options.timeout,
        sameOriginOnly: validatedInput.options.sameOrigin,
        concurrency: validatedInput.options.concurrency,
      });

      dependencies.io.stdout(
        formatWebSitemap(sitemap, validatedInput.options.json),
      );
    });
};
