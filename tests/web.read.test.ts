import { describe, expect, it, vi } from "vitest";

import {
  createFetchWebPageReader,
  formatWebPageContent,
  runWebFetchCommand,
  WebPageReadError,
} from "#app/services/web/fetch.ts";

type WebPageContent = Awaited<
  ReturnType<ReturnType<typeof createFetchWebPageReader>["read"]>
>;

const sampleContent = {
  requestedUrl: "https://example.com/requested",
  finalUrl: "https://example.com/final",
  canonicalUrl: "https://example.com/canonical",
  title: "Example page",
  excerpt: "Example excerpt",
  description: "Example description",
  byline: "Jane Doe",
  siteName: "Example",
  text: "Heading\n\nParagraph text.",
  html: "<article><h1>Heading</h1><p>Paragraph text.</p></article>",
  markdown: "# Heading\n\nParagraph text.",
} satisfies WebPageContent;

describe("formatWebPageContent", () => {
  it("formats markdown output", () => {
    expect(formatWebPageContent(sampleContent, "markdown")).toBe(
      "# Heading\n\nParagraph text.\n",
    );
  });

  it("formats text output", () => {
    expect(formatWebPageContent(sampleContent, "text")).toBe(
      "Heading\n\nParagraph text.\n",
    );
  });

  it("formats html output", () => {
    expect(formatWebPageContent(sampleContent, "html")).toBe(
      "<article><h1>Heading</h1><p>Paragraph text.</p></article>\n",
    );
  });

  it("formats json output", () => {
    expect(JSON.parse(formatWebPageContent(sampleContent, "json"))).toEqual(
      sampleContent,
    );
  });
});

describe("runWebFetchCommand", () => {
  it("reads a page with validated input and formats the requested output", async () => {
    const requests: Array<{ url: string; timeoutMs: number }> = [];

    const output = await runWebFetchCommand(
      {
        url: "https://example.com/article",
        options: {
          format: "markdown",
          timeout: 1_000,
        },
      },
      {
        webPageReader: {
          read: async (request) => {
            requests.push(request);
            return sampleContent;
          },
        },
      },
    );

    expect(output).toBe("# Heading\n\nParagraph text.\n");
    expect(requests).toEqual([
      {
        url: "https://example.com/article",
        timeoutMs: 1_000,
      },
    ]);
  });

  it("validates fetch urls", async () => {
    await expect(
      runWebFetchCommand(
        {
          url: "not-a-url",
          options: {
            format: "markdown",
            timeout: 1_000,
          },
        },
        {
          webPageReader: {
            read: async () => sampleContent,
          },
        },
      ),
    ).rejects.toThrowError("URL must be a valid absolute URL.");
  });
});

describe("createFetchWebPageReader", () => {
  it("reads an html page and converts it to markdown", async () => {
    const reader = createFetchWebPageReader({
      fetchImplementation: vi.fn(async (input, init) => {
        const url = input instanceof URL ? input : new URL(String(input));

        expect(url.toString()).toBe("https://example.com/article");
        expect(init?.headers).toBeInstanceOf(Headers);
        expect((init?.headers as Headers).get("accept")).toBe(
          "text/html,application/xhtml+xml",
        );

        return new Response(
          `
            <html>
              <head>
                <title>Ignored title</title>
                <link rel="canonical" href="/canonical" />
                <meta name="description" content="Example description" />
                <meta property="og:site_name" content="Example site" />
              </head>
              <body>
                <article>
                  <h1>Heading</h1>
                  <p>Paragraph <strong>text</strong>.</p>
                </article>
              </body>
            </html>
          `,
          {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
            status: 200,
          },
        );
      }),
      userAgent: "devtools-test",
    });

    const result = await reader.read({
      url: "https://example.com/article",
      timeoutMs: 1_000,
    });

    expect(result.requestedUrl).toBe("https://example.com/article");
    expect(result.finalUrl).toBe("https://example.com/article");
    expect(result.canonicalUrl).toBe("https://example.com/canonical");
    expect(result.title).toBe("Ignored title");
    expect(result.description).toBe("Example description");
    expect(result.siteName).toBe("Example site");
    expect(result.text).toContain("Heading");
    expect(result.text).toContain("Paragraph text.");
    expect(result.html).toContain("Heading</h2>");
    expect(result.markdown).toContain("Heading");
    expect(result.markdown).toContain("Paragraph **text**.");
  });

  it("falls back to the raw body when readability cannot parse an article", async () => {
    const reader = createFetchWebPageReader({
      fetchImplementation: vi.fn(async () => {
        return new Response(
          "<html><body><div>Plain content</div></body></html>",
          {
            headers: {
              "Content-Type": "text/html",
            },
            status: 200,
          },
        );
      }),
    });

    const result = await reader.read({
      url: "https://example.com/plain",
      timeoutMs: 1_000,
    });

    expect(result.text).toContain("Plain content");
    expect(result.markdown).toContain("Plain content");
  });

  it("rejects non-html responses", async () => {
    const reader = createFetchWebPageReader({
      fetchImplementation: vi.fn(async () => {
        return new Response("{}", {
          headers: {
            "Content-Type": "application/json",
          },
          status: 200,
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/data.json",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Unsupported content type: application/json.");
  });

  it("wraps fetch failures", async () => {
    const reader = createFetchWebPageReader({
      fetchImplementation: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/article",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Web request failed: network down");
  });

  it("throws a timeout error", async () => {
    const reader = createFetchWebPageReader({
      fetchImplementation: vi.fn(async (_input, init) => {
        init?.signal?.throwIfAborted();

        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        init?.signal?.throwIfAborted();

        return new Response("<html><body>never reached</body></html>", {
          headers: {
            "Content-Type": "text/html",
          },
          status: 200,
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/slow",
        timeoutMs: 1,
      }),
    ).rejects.toThrowError("Web request timed out after 1ms.");
  });

  it("throws WebPageReadError instances", async () => {
    const reader = createFetchWebPageReader({
      fetchImplementation: vi.fn(async () => {
        return new Response("not found", {
          headers: {
            "Content-Type": "text/html",
          },
          status: 404,
          statusText: "Not Found",
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/missing",
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(WebPageReadError);
  });
});
