import { JSDOM } from "jsdom";

import { readOptionalString } from "#app/lib/string.ts";
import {
  createRequestHeaders,
  fetchWithTimeout,
  requireContentType,
} from "#app/services/web/http.ts";
import { normalizeAbsoluteUrl } from "#app/services/web/url.ts";

export type HtmlPageLoadRequest = Readonly<{
  url: string;
  timeoutMs: number;
}>;

export type LoadedHtmlPage = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  html: string;
  statusCode: number;
  statusText: string;
  contentType: string;
  headers: Headers;
}>;

export const createHtmlPageLoader = (dependencies: {
  fetchImplementation: typeof fetch;
  userAgent?: string;
}) => {
  return {
    load: async (request: HtmlPageLoadRequest): Promise<LoadedHtmlPage> => {
      const response = await fetchWithTimeout({
        url: request.url,
        timeoutMs: request.timeoutMs,
        subject: "Web request",
        fetchImplementation: dependencies.fetchImplementation,
        headers: createRequestHeaders(
          "text/html,application/xhtml+xml",
          dependencies.userAgent,
        ),
      });

      if (!response.ok) {
        throw new Error(
          `Web request failed with ${response.status} ${response.statusText}.`,
        );
      }

      const contentType = requireContentType(response, [
        "text/html",
        "application/xhtml+xml",
      ]);

      return {
        requestedUrl: normalizeAbsoluteUrl(request.url, { keepHash: true }),
        finalUrl:
          response.url === ""
            ? normalizeAbsoluteUrl(request.url, { keepHash: true })
            : normalizeAbsoluteUrl(response.url, { keepHash: true }),
        html: await response.text(),
        statusCode: response.status,
        statusText: response.statusText,
        contentType,
        headers: response.headers,
      };
    },
  };
};

export const withHtmlDocument = <T>(
  html: string,
  url: string,
  read: (document: Document) => T,
): T => {
  const dom = new JSDOM(html, { url });

  try {
    return read(dom.window.document);
  } finally {
    dom.window.close();
  }
};

export const readMetaContent = (document: Document, selector: string) => {
  const element = document.querySelector(selector);

  return readOptionalString(element?.getAttribute("content"));
};

export const readDocumentTitle = (document: Document) => {
  return readOptionalString(document.title);
};

export const readCanonicalUrl = (document: Document, finalUrl: string) => {
  const canonicalHref = document
    .querySelector('link[rel~="canonical"]')
    ?.getAttribute("href");

  if (canonicalHref === null || canonicalHref === undefined) {
    return undefined;
  }

  try {
    return normalizeAbsoluteUrl(new URL(canonicalHref, finalUrl).toString(), {
      keepHash: true,
    });
  } catch {
    return undefined;
  }
};
