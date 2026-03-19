import { describe, expect, it, vi } from "vitest";

import {
  createHtmlPageLoader,
  readCanonicalUrl,
  readDocumentTitle,
  readMetaContent,
  withHtmlDocument,
} from "#app/services/web/page.ts";

describe("createHtmlPageLoader", () => {
  it("loads html pages and normalizes requested and final urls", async () => {
    const loader = createHtmlPageLoader({
      fetchImplementation: vi.fn(async (_input, init) => {
        expect(init?.headers).toBeInstanceOf(Headers);
        expect((init?.headers as Headers).get("accept")).toBe(
          "text/html,application/xhtml+xml",
        );
        expect((init?.headers as Headers).get("user-agent")).toBe(
          "devtools-test",
        );

        const response = new Response("<html><body>Hello</body></html>", {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });

        Object.defineProperty(response, "url", {
          value: "https://example.com/final/page#details",
        });

        return response;
      }),
      userAgent: "devtools-test",
    });

    const page = await loader.load({
      url: "HTTPS://Example.com:443/requested#fragment",
      timeoutMs: 1_000,
    });

    expect(page).toMatchObject({
      requestedUrl: "https://example.com/requested#fragment",
      finalUrl: "https://example.com/final/page#details",
      statusCode: 200,
      statusText: "OK",
      contentType: "text/html; charset=utf-8",
      html: "<html><body>Hello</body></html>",
    });
  });

  it("falls back to the requested url when the response has no final url", async () => {
    const loader = createHtmlPageLoader({
      fetchImplementation: vi.fn(async () => {
        return new Response("<html><body>Hello</body></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    const page = await loader.load({
      url: "https://example.com/requested#fragment",
      timeoutMs: 1_000,
    });

    expect(page.finalUrl).toBe("https://example.com/requested#fragment");
  });

  it("rejects non-ok responses", async () => {
    const loader = createHtmlPageLoader({
      fetchImplementation: vi.fn(async () => {
        return new Response("missing", {
          status: 404,
          statusText: "Not Found",
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    await expect(
      loader.load({
        url: "https://example.com/requested",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Web request failed with 404 Not Found.");
  });

  it("rejects non-html responses", async () => {
    const loader = createHtmlPageLoader({
      fetchImplementation: vi.fn(async () => {
        return new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }),
    });

    await expect(
      loader.load({
        url: "https://example.com/requested",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Unsupported content type: application/json.");
  });
});

describe("document helpers", () => {
  it("reads document metadata from html", () => {
    const metadata = withHtmlDocument(
      `
        <html>
          <head>
            <title> Example page </title>
            <meta name="description" content=" Example description " />
            <link rel="canonical alternate" href="/canonical#hash" />
          </head>
          <body></body>
        </html>
      `,
      "https://example.com/articles/intro",
      (document) => {
        return {
          title: readDocumentTitle(document),
          description: readMetaContent(document, 'meta[name="description"]'),
          canonicalUrl: readCanonicalUrl(
            document,
            "https://example.com/articles/intro",
          ),
        };
      },
    );

    expect(metadata).toEqual({
      title: "Example page",
      description: "Example description",
      canonicalUrl: "https://example.com/canonical#hash",
    });
  });

  it("returns undefined for missing or invalid metadata", () => {
    const metadata = withHtmlDocument(
      `
        <html>
          <head>
            <title>   </title>
            <meta name="description" content="   " />
            <link rel="canonical" href="http://[::1" />
          </head>
          <body></body>
        </html>
      `,
      "https://example.com/articles/intro",
      (document) => {
        return {
          title: readDocumentTitle(document),
          description: readMetaContent(document, 'meta[name="description"]'),
          canonicalUrl: readCanonicalUrl(
            document,
            "https://example.com/articles/intro",
          ),
        };
      },
    );

    expect(metadata).toEqual({
      title: undefined,
      description: undefined,
      canonicalUrl: undefined,
    });
  });
});
