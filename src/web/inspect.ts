import type { Command } from "commander";
import { z } from "zod";

import {
  createHtmlPageLoader,
  readCanonicalUrl,
  readDocumentTitle,
  readMetaContent,
  withHtmlDocument,
} from "#app/web/page.ts";
import {
  absoluteHttpUrlSchema,
  defaultWebRequestTimeoutMs,
  ensureTrailingNewline,
  formatInputIssues,
  readOptionalString,
} from "#app/web/shared.ts";

type WebPageInspectRequest = Readonly<{
  url: string;
  timeoutMs: number;
}>;

type WebPageInspection = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | undefined;
  statusCode: number;
  statusText: string;
  contentType: string;
  contentLength: number | undefined;
  lastModified: string | undefined;
  etag: string | undefined;
  title: string | undefined;
  description: string | undefined;
  siteName: string | undefined;
  language: string | undefined;
  robots: string | undefined;
}>;

type WebPageInspector = Readonly<{
  inspect: (request: WebPageInspectRequest) => Promise<WebPageInspection>;
}>;

export class WebPageInspectError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebPageInspectError";
  }
}

const inspectCommandSchema = z.object({
  options: z.object({
    json: z.boolean(),
    timeout: z.coerce
      .number()
      .int("Timeout must be an integer.")
      .positive("Timeout must be greater than 0."),
  }),
  url: absoluteHttpUrlSchema,
});

const parseInspectCommandInput = (input: unknown) => {
  const result = inspectCommandSchema.safeParse(input);

  if (!result.success) {
    throw new WebPageInspectError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const parseContentLength = (value: string | null) => {
  if (value === null) {
    return undefined;
  }

  const parsedValue = Number.parseInt(value, 10);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
};

const formatField = (label: string, value: string | number | undefined) => {
  return `${label}: ${value ?? ""}`.trimEnd();
};

export const formatWebPageInspection = (
  inspection: WebPageInspection,
  json: boolean,
) => {
  if (json) {
    return `${JSON.stringify(inspection, null, 2)}\n`;
  }

  return ensureTrailingNewline(
    [
      formatField("Requested URL", inspection.requestedUrl),
      formatField("Final URL", inspection.finalUrl),
      formatField("Canonical URL", inspection.canonicalUrl),
      formatField(
        "Status",
        `${inspection.statusCode} ${inspection.statusText}`.trim(),
      ),
      formatField("Content-Type", inspection.contentType),
      formatField("Content-Length", inspection.contentLength),
      formatField("Last-Modified", inspection.lastModified),
      formatField("ETag", inspection.etag),
      formatField("Title", inspection.title),
      formatField("Description", inspection.description),
      formatField("Site name", inspection.siteName),
      formatField("Language", inspection.language),
      formatField("Robots", inspection.robots),
    ].join("\n"),
  );
};

export const createWebPageInspector = (dependencies: {
  fetchImplementation: typeof fetch;
  userAgent?: string;
}) => {
  const htmlPageLoader = createHtmlPageLoader(dependencies);

  return {
    inspect: async (request: WebPageInspectRequest) => {
      try {
        const page = await htmlPageLoader.load(request);

        return withHtmlDocument(page.html, page.finalUrl, (document) => {
          return {
            requestedUrl: page.requestedUrl,
            finalUrl: page.finalUrl,
            canonicalUrl: readCanonicalUrl(document, page.finalUrl),
            statusCode: page.statusCode,
            statusText: page.statusText,
            contentType: page.contentType,
            contentLength: parseContentLength(
              page.headers.get("content-length"),
            ),
            lastModified: readOptionalString(page.headers.get("last-modified")),
            etag: readOptionalString(page.headers.get("etag")),
            title: readDocumentTitle(document),
            description: readMetaContent(document, 'meta[name="description"]'),
            siteName: readMetaContent(
              document,
              'meta[property="og:site_name"]',
            ),
            language: readOptionalString(document.documentElement.lang),
            robots: readMetaContent(document, 'meta[name="robots"]'),
          } satisfies WebPageInspection;
        });
      } catch (error: unknown) {
        throw new WebPageInspectError(
          error instanceof Error ? error.message : "Web request failed.",
        );
      }
    },
  } satisfies WebPageInspector;
};

export const registerWebInspectCommand = (
  webCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    webPageInspector: WebPageInspector;
  },
) => {
  webCommand
    .command("inspect")
    .description(
      "Fetch a web page and print metadata without article extraction",
    )
    .argument("<url>", "Web page URL")
    .option("--json", "Print inspection results as JSON", false)
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultWebRequestTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseInspectCommandInput({ options, url });
      const inspection = await dependencies.webPageInspector.inspect({
        url: validatedInput.url,
        timeoutMs: validatedInput.options.timeout,
      });

      dependencies.io.stdout(
        formatWebPageInspection(inspection, validatedInput.options.json),
      );
    });
};
