import { Readability } from "@mozilla/readability";
import type { Command } from "commander";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { z } from "zod";

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
  title: string | undefined;
  excerpt: string | undefined;
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

const defaultTimeoutMs = "10000";

const fetchCommandSchema = z.object({
  options: z.object({
    format: z.enum(webPageOutputFormats),
    timeout: z.coerce
      .number()
      .int("Timeout must be an integer.")
      .positive("Timeout must be greater than 0."),
  }),
  url: z
    .string()
    .trim()
    .superRefine((value, context) => {
      try {
        const parsedUrl = new URL(value);

        if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
          return;
        }
      } catch {
        context.addIssue({
          code: "custom",
          message: "URL must be a valid absolute URL.",
        });

        return;
      }

      context.addIssue({
        code: "custom",
        message: "URL must use http or https.",
      });
    }),
});

const normalizeWhitespace = (value: string): string => {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const createMarkdown = (html: string): string => {
  const turndownService = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });

  return normalizeWhitespace(turndownService.turndown(html));
};

const parseArticle = (requestedUrl: string, finalUrl: string, html: string) => {
  const dom = new JSDOM(html, { url: finalUrl });

  try {
    const article = new Readability(dom.window.document).parse();
    const title = dom.window.document.title.trim();
    const body = dom.window.document.body;
    const fallbackHtml = body.innerHTML.trim();
    const fallbackText = normalizeWhitespace(body.textContent ?? "");
    const articleHtml = normalizeWhitespace(article?.content ?? fallbackHtml);
    const articleText = normalizeWhitespace(
      article?.textContent ?? fallbackText,
    );

    return {
      requestedUrl,
      finalUrl,
      title: article?.title ?? (title === "" ? undefined : title),
      excerpt: article?.excerpt ?? undefined,
      byline: article?.byline ?? undefined,
      siteName: article?.siteName ?? undefined,
      text: articleText,
      html: articleHtml,
      markdown: createMarkdown(articleHtml),
    };
  } finally {
    dom.window.close();
  }
};

const ensureTrailingNewline = (value: string) => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

const createHeaders = (userAgent?: string): Headers => {
  const headers = new Headers({
    Accept: "text/html,application/xhtml+xml",
  });

  if (userAgent !== undefined && userAgent !== "") {
    headers.set("User-Agent", userAgent);
  }

  return headers;
};

const formatInputIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "input" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
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
  return {
    read: async (request: WebPageReadRequest) => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort();
      }, request.timeoutMs);

      let response: Response;

      try {
        response = await dependencies.fetchImplementation(request.url, {
          headers: createHeaders(dependencies.userAgent),
          signal: abortController.signal,
        });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new WebPageReadError(
            `Web request timed out after ${request.timeoutMs}ms.`,
          );
        }

        throw new WebPageReadError(
          error instanceof Error
            ? `Web request failed: ${error.message}`
            : "Web request failed.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new WebPageReadError(
          `Web request failed with ${response.status} ${response.statusText}.`,
        );
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml")
      ) {
        throw new WebPageReadError(
          `Unsupported content type: ${contentType || "unknown"}.`,
        );
      }

      const responseHtml = await response.text();
      const finalUrl = response.url === "" ? request.url : response.url;

      return parseArticle(request.url, finalUrl, responseHtml);
    },
  };
};

export const registerWebFetchCommand = (
  webCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    webPageReader: WebPageReader;
  },
) => {
  webCommand
    .command("fetch")
    .description("Fetch a web page and convert it to structured output")
    .argument("<url>", "Web page URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webPageOutputFormats.join(", ")}`,
      "markdown",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseFetchCommandInput({ options, url });
      const content = await dependencies.webPageReader.read({
        url: validatedInput.url,
        timeoutMs: validatedInput.options.timeout,
      });

      dependencies.io.stdout(
        formatWebPageContent(content, validatedInput.options.format),
      );
    });
};
