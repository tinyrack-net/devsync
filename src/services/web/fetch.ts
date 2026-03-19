import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { z } from "zod";
import { ensureTrailingNewline, normalizeWhitespace } from "#app/lib/string.ts";
import { formatInputIssues } from "#app/lib/validation.ts";
import {
  createHtmlPageLoader,
  readCanonicalUrl,
  readDocumentTitle,
  readMetaContent,
  withHtmlDocument,
} from "#app/services/web/page.ts";
import { absoluteHttpUrlSchema } from "#app/services/web/url.ts";

export const webPageOutputFormats = [
  "markdown",
  "text",
  "html",
  "json",
] as const;

type WebPageOutputFormat = (typeof webPageOutputFormats)[number];

type WebPageReadRequest = Readonly<{
  url: string;
  timeoutMs: number;
}>;

type WebPageContent = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | undefined;
  title: string | undefined;
  excerpt: string | undefined;
  description: string | undefined;
  byline: string | undefined;
  siteName: string | undefined;
  text: string;
  html: string;
  markdown: string;
}>;

type WebPageReader = Readonly<{
  read: (request: WebPageReadRequest) => Promise<WebPageContent>;
}>;

export class WebPageReadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebPageReadError";
  }
}

const fetchCommandSchema = z.object({
  options: z.object({
    format: z.enum(webPageOutputFormats),
    timeout: z.coerce
      .number()
      .int("Timeout must be an integer.")
      .positive("Timeout must be greater than 0."),
  }),
  url: absoluteHttpUrlSchema,
});

const createMarkdown = (html: string): string => {
  const turndownService = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });

  return normalizeWhitespace(turndownService.turndown(html));
};

const parseArticle = (requestedUrl: string, finalUrl: string, html: string) => {
  return withHtmlDocument(html, finalUrl, (document) => {
    const article = new Readability(document).parse();
    const body = document.body;
    const fallbackHtml = body.innerHTML.trim();
    const fallbackText = normalizeWhitespace(body.textContent ?? "");
    const articleHtml = normalizeWhitespace(article?.content ?? fallbackHtml);
    const articleText = normalizeWhitespace(
      article?.textContent ?? fallbackText,
    );

    return {
      requestedUrl,
      finalUrl,
      canonicalUrl: readCanonicalUrl(document, finalUrl),
      title: article?.title ?? readDocumentTitle(document),
      excerpt: article?.excerpt ?? undefined,
      description:
        article?.excerpt ??
        readMetaContent(document, 'meta[name="description"]') ??
        undefined,
      byline: article?.byline ?? undefined,
      siteName:
        article?.siteName ??
        readMetaContent(document, 'meta[property="og:site_name"]') ??
        undefined,
      text: articleText,
      html: articleHtml,
      markdown: createMarkdown(articleHtml),
    } satisfies WebPageContent;
  });
};

const parseFetchCommandInput = (input: unknown) => {
  const result = fetchCommandSchema.safeParse(input);

  if (!result.success) {
    throw new WebPageReadError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

export const formatWebPageContent = (
  content: WebPageContent,
  format: WebPageOutputFormat,
) => {
  switch (format) {
    case "markdown":
      return ensureTrailingNewline(content.markdown);
    case "text":
      return ensureTrailingNewline(content.text);
    case "html":
      return ensureTrailingNewline(content.html);
    case "json":
      return `${JSON.stringify(content, null, 2)}\n`;
  }
};

export const createFetchWebPageReader = (dependencies: {
  fetchImplementation: typeof fetch;
  userAgent?: string;
}) => {
  const htmlPageLoader = createHtmlPageLoader(dependencies);

  return {
    read: async (request: WebPageReadRequest) => {
      try {
        const page = await htmlPageLoader.load(request);

        return parseArticle(page.requestedUrl, page.finalUrl, page.html);
      } catch (error: unknown) {
        throw new WebPageReadError(
          error instanceof Error ? error.message : "Web request failed.",
        );
      }
    },
  } satisfies WebPageReader;
};

export const runWebFetchCommand = async (
  input: Readonly<{
    url: string;
    options: Record<string, unknown>;
  }>,
  dependencies: {
    webPageReader: WebPageReader;
  },
) => {
  const validatedInput = parseFetchCommandInput(input);
  const content = await dependencies.webPageReader.read({
    url: validatedInput.url,
    timeoutMs: validatedInput.options.timeout,
  });

  return formatWebPageContent(content, validatedInput.options.format);
};
