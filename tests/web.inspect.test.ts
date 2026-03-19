import { describe, expect, it, vi } from "vitest";

import {
  createWebPageInspector,
  formatWebPageInspection,
  runWebInspectCommand,
  WebPageInspectError,
} from "#app/services/web/inspect.ts";

type WebPageInspection = Awaited<
  ReturnType<ReturnType<typeof createWebPageInspector>["inspect"]>
>;

const sampleInspection = {
  requestedUrl: "https://example.com/requested",
  finalUrl: "https://example.com/final",
  canonicalUrl: "https://example.com/canonical",
  statusCode: 200,
  statusText: "OK",
  contentType: "text/html; charset=utf-8",
  contentLength: 1234,
  lastModified: "Tue, 18 Mar 2025 12:00:00 GMT",
  etag: '"etag-123"',
  title: "Example page",
  description: "Example description",
  siteName: "Example",
  language: "en",
  robots: "index,follow",
} satisfies WebPageInspection;

describe("formatWebPageInspection", () => {
  it("formats text output", () => {
    expect(formatWebPageInspection(sampleInspection, false)).toContain(
      "Canonical URL: https://example.com/canonical",
    );
  });

  it("formats json output", () => {
    expect(JSON.parse(formatWebPageInspection(sampleInspection, true))).toEqual(
      sampleInspection,
    );
  });
});

describe("runWebInspectCommand", () => {
  it("maps validated input to the inspector and formats the result", async () => {
    const requests: Array<{ url: string; timeoutMs: number }> = [];

    const output = await runWebInspectCommand(
      {
        url: "https://example.com/article",
        options: {
          json: true,
          timeout: 1_000,
        },
      },
      {
        webPageInspector: {
          inspect: async (request) => {
            requests.push(request);
            return sampleInspection;
          },
        },
      },
    );

    expect(JSON.parse(output)).toEqual(sampleInspection);
    expect(requests).toEqual([
      {
        url: "https://example.com/article",
        timeoutMs: 1_000,
      },
    ]);
  });

  it("validates timeout values", async () => {
    await expect(
      runWebInspectCommand(
        {
          url: "https://example.com/article",
          options: {
            json: false,
            timeout: 0,
          },
        },
        {
          webPageInspector: {
            inspect: async () => sampleInspection,
          },
        },
      ),
    ).rejects.toThrowError("Timeout must be greater than 0.");
  });
});

describe("createWebPageInspector", () => {
  it("reads html metadata and follows the final response url", async () => {
    const inspector = createWebPageInspector({
      fetchImplementation: vi.fn(async () => {
        const response = new Response(
          `
            <html lang="en">
              <head>
                <title>Example page</title>
                <meta name="description" content="Example description" />
                <meta property="og:site_name" content="Example" />
                <meta name="robots" content="index,follow" />
                <link rel="canonical" href="/canonical" />
              </head>
              <body><main>Hello</main></body>
            </html>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Content-Length": "1234",
              ETag: '"etag-123"',
              "Last-Modified": "Tue, 18 Mar 2025 12:00:00 GMT",
            },
          },
        );

        Object.defineProperty(response, "url", {
          value: "https://example.com/final/article#summary",
        });

        return response;
      }),
      userAgent: "devtools-test",
    });

    const inspection = await inspector.inspect({
      url: "https://example.com/article",
      timeoutMs: 1_000,
    });

    expect(inspection).toEqual({
      requestedUrl: "https://example.com/article",
      finalUrl: "https://example.com/final/article#summary",
      canonicalUrl: "https://example.com/canonical",
      statusCode: 200,
      statusText: "",
      contentType: "text/html; charset=utf-8",
      contentLength: 1234,
      lastModified: "Tue, 18 Mar 2025 12:00:00 GMT",
      etag: '"etag-123"',
      title: "Example page",
      description: "Example description",
      siteName: "Example",
      language: "en",
      robots: "index,follow",
    });
  });

  it("returns undefined for missing optional metadata", async () => {
    const inspector = createWebPageInspector({
      fetchImplementation: vi.fn(async () => {
        return new Response(
          `
            <html>
              <head>
                <title>   </title>
                <meta name="description" content="   " />
              </head>
              <body><main>Hello</main></body>
            </html>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html",
              "Content-Length": "not-a-number",
              ETag: "   ",
              "Last-Modified": "   ",
            },
          },
        );
      }),
    });

    const inspection = await inspector.inspect({
      url: "https://example.com/article",
      timeoutMs: 1_000,
    });

    expect(inspection).toMatchObject({
      canonicalUrl: undefined,
      contentLength: undefined,
      description: undefined,
      etag: undefined,
      language: undefined,
      lastModified: undefined,
      robots: undefined,
      siteName: undefined,
      title: undefined,
    });
  });

  it("rejects non-html responses", async () => {
    const inspector = createWebPageInspector({
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
      inspector.inspect({
        url: "https://example.com/article",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Unsupported content type: application/json.");
  });

  it("wraps timeout failures", async () => {
    const inspector = createWebPageInspector({
      fetchImplementation: vi.fn(async (_input, init) => {
        init?.signal?.throwIfAborted();

        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        init?.signal?.throwIfAborted();

        return new Response("never reached", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    await expect(
      inspector.inspect({
        url: "https://example.com/article",
        timeoutMs: 1,
      }),
    ).rejects.toThrowError("Web request timed out after 1ms.");
  });

  it("wraps request failures", async () => {
    const inspector = createWebPageInspector({
      fetchImplementation: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    await expect(
      inspector.inspect({
        url: "https://example.com/article",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Web request failed: network down");
  });

  it("throws WebPageInspectError instances", async () => {
    const inspector = createWebPageInspector({
      fetchImplementation: vi.fn(async () => {
        return new Response("not found", {
          status: 404,
          statusText: "Not Found",
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    await expect(
      inspector.inspect({
        url: "https://example.com/article",
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(WebPageInspectError);
  });
});
