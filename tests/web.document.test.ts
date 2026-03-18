import { describe, expect, it, vi } from "vitest";

import {
  createFetchWebDocumentLoader,
  createFetchWebPageInspector,
  formatWebPageCodeBlocks,
  formatWebPageExtract,
  formatWebPageLinks,
  formatWebPageMetadata,
  formatWebPageTables,
} from "../src/web/document.ts";
import { createFetchWebClient } from "../src/web/fetch-client.ts";
import { WebPageReadError } from "../src/web/read.ts";

const articleHtml = `
  <html lang="en">
    <head>
      <title>Example page</title>
      <meta name="description" content="Example description" />
      <meta property="og:title" content="OG title" />
      <meta name="twitter:card" content="summary" />
      <link rel="canonical" href="/article" />
    </head>
    <body>
      <main class="main">
        <article>
          <h1>Heading</h1>
          <p>Paragraph <strong>text</strong>.</p>
          <div class="item">First item</div>
          <div class="item">Second item</div>
          <a href="/docs">Docs</a>
          <a href="/docs">Docs duplicate</a>
          <a href="https://external.example.com" rel="nofollow">External</a>
          <a href="mailto:test@example.com">Mail</a>
          <pre><code class="language-ts">console.log('hello');</code></pre>
          <code>npm run test</code>
          <table>
            <caption>Options</caption>
            <thead>
              <tr><th>Name</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr><td>format</td><td>json</td></tr>
            </tbody>
          </table>
        </article>
      </main>
    </body>
  </html>
`;

const fallbackTableHtml = `
  <html>
    <body>
      <table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>format</td><td>json</td></tr>
      </table>
    </body>
  </html>
`;

const createInspector = (html: string) => {
  const fetchClient = createFetchWebClient({
    fetchImplementation: vi.fn(async () => {
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
        status: 200,
      });
    }),
    userAgent: "devtools-test",
  });
  const loader = createFetchWebDocumentLoader(fetchClient);

  return createFetchWebPageInspector(loader);
};

describe("createFetchWebPageInspector", () => {
  it("extracts metadata", async () => {
    const metadata = await createInspector(articleHtml).meta({
      url: "https://example.com/article",
      timeoutMs: 1_000,
    });

    expect(metadata).toMatchObject({
      title: "Example page",
      description: "Example description",
      canonicalUrl: "https://example.com/article",
      lang: "en",
      openGraph: { title: "OG title" },
      twitter: { card: "summary" },
    });
    expect(formatWebPageMetadata(metadata, "text")).toContain(
      "Title: Example page",
    );
  });

  it("extracts unique links and classifies them as internal or external", async () => {
    const result = await createInspector(articleHtml).links({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      unique: true,
      internalOnly: false,
      externalOnly: false,
    });

    expect(result.links).toEqual([
      {
        url: "https://example.com/docs",
        text: "Docs",
        internal: true,
        rel: [],
      },
      {
        url: "https://external.example.com/",
        text: "External",
        internal: false,
        rel: ["nofollow"],
      },
    ]);
    expect(formatWebPageLinks(result, "markdown")).toContain(
      "- [Docs](https://example.com/docs)",
    );
  });

  it("supports internal-only and external-only link extraction", async () => {
    const inspector = createInspector(articleHtml);

    const internalOnly = await inspector.links({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      unique: true,
      internalOnly: true,
      externalOnly: false,
    });
    const externalOnly = await inspector.links({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      unique: true,
      internalOnly: false,
      externalOnly: true,
    });

    expect(internalOnly.links).toHaveLength(1);
    expect(internalOnly.links[0]?.url).toBe("https://example.com/docs");
    expect(externalOnly.links).toHaveLength(1);
    expect(externalOnly.links[0]?.url).toBe("https://external.example.com/");
  });

  it("extracts all matches by selector", async () => {
    const result = await createInspector(articleHtml).extract({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      selector: ".item",
      all: true,
    });

    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((match) => match.text)).toEqual([
      "First item",
      "Second item",
    ]);
    expect(formatWebPageExtract(result, "markdown")).toContain("---");
  });

  it("throws a helpful error when no selector matches", async () => {
    await expect(
      createInspector(articleHtml).extract({
        url: "https://example.com/article",
        timeoutMs: 1_000,
        selector: ".missing",
        all: false,
      }),
    ).rejects.toThrowError("No elements matched selector: .missing");
  });

  it("throws a helpful error for invalid selectors", async () => {
    await expect(
      createInspector(articleHtml).extract({
        url: "https://example.com/article",
        timeoutMs: 1_000,
        selector: "[",
        all: false,
      }),
    ).rejects.toBeInstanceOf(WebPageReadError);

    await expect(
      createInspector(articleHtml).extract({
        url: "https://example.com/article",
        timeoutMs: 1_000,
        selector: "[",
        all: false,
      }),
    ).rejects.toThrowError("Invalid selector: [");
  });

  it("extracts code blocks and supports language filtering", async () => {
    const inspector = createInspector(articleHtml);
    const filtered = await inspector.code({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      language: "ts",
    });
    const allBlocks = await inspector.code({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      language: undefined,
    });

    expect(filtered.blocks).toEqual([
      {
        code: "console.log('hello');",
        html: "<pre><code class=\"language-ts\">console.log('hello');</code></pre>",
        language: "ts",
      },
    ]);
    expect(allBlocks.blocks).toHaveLength(2);
    expect(formatWebPageCodeBlocks(filtered, "markdown")).toContain("```ts");
  });

  it("extracts tables with explicit headers", async () => {
    const result = await createInspector(articleHtml).tables({
      url: "https://example.com/article",
      timeoutMs: 1_000,
    });

    expect(result.tables[0]).toMatchObject({
      caption: "Options",
      headers: ["Name", "Value"],
      rows: [["format", "json"]],
    });
    expect(formatWebPageTables(result, "markdown")).toContain(
      "| Name | Value |",
    );
  });

  it("falls back to generated column names when no table header section exists", async () => {
    const result = await createInspector(fallbackTableHtml).tables({
      url: "https://example.com/table",
      timeoutMs: 1_000,
    });

    expect(result.tables[0]).toMatchObject({
      headers: ["column1", "column2"],
      rows: [["format", "json"]],
    });
  });
});
