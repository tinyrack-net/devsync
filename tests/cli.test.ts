import { describe, expect, it } from "vitest";

import { type CliServices, runCli } from "../src/cli.ts";
import type {
  WebCrawlResult,
  WebRobotsResult,
  WebSitemapResult,
} from "../src/web/discovery.ts";
import type {
  WebPageCodeBlocksResult,
  WebPageExtractResult,
  WebPageLinksResult,
  WebPageMetadata,
  WebPageTablesResult,
} from "../src/web/document.ts";
import type { WebPageContent, WebPageReadRequest } from "../src/web/read.ts";
import {
  type WebSearchEngine,
  createSearchEngineRegistry,
} from "../src/web/search.ts";

const packageInfo = {
  name: "devtools",
  version: "0.1.0",
} as const;

const samplePageContent: WebPageContent = {
  requestedUrl: "https://example.com/requested",
  finalUrl: "https://example.com/final",
  title: "Example page",
  excerpt: "Example excerpt",
  byline: "Jane Doe",
  siteName: "Example",
  text: "Heading\n\nParagraph text.",
  html: "<article><h1>Heading</h1><p>Paragraph text.</p></article>",
  markdown: "# Heading\n\nParagraph text.",
};

const sampleMetadata: WebPageMetadata = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/article",
  title: "Example page",
  description: "Example description",
  canonicalUrl: "https://example.com/article",
  excerpt: "Example excerpt",
  byline: "Jane Doe",
  siteName: "Example",
  lang: "en",
  openGraph: {
    title: "OG title",
  },
  twitter: {
    card: "summary",
  },
};

const sampleLinks: WebPageLinksResult = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/article",
  links: [
    {
      url: "https://example.com/docs",
      text: "Docs",
      internal: true,
      rel: [],
    },
    {
      url: "https://external.example.com",
      text: "External",
      internal: false,
      rel: ["nofollow"],
    },
  ],
};

const sampleExtract: WebPageExtractResult = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/article",
  selector: ".main",
  matches: [
    {
      selector: ".main",
      text: "Main section",
      html: '<div class="main">Main section</div>',
      markdown: "Main section",
    },
  ],
};

const sampleCodeBlocks: WebPageCodeBlocksResult = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/article",
  blocks: [
    {
      language: "ts",
      code: "console.log('hello');",
      html: "<pre><code class=\"language-ts\">console.log('hello');</code></pre>",
    },
  ],
};

const sampleTables: WebPageTablesResult = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/article",
  tables: [
    {
      caption: "Options",
      headers: ["Name", "Value"],
      rows: [["format", "json"]],
      html: "<table><tr><th>Name</th><th>Value</th></tr><tr><td>format</td><td>json</td></tr></table>",
      markdown: "| Name | Value |\n| --- | --- |\n| format | json |",
    },
  ],
};

const sampleRobots: WebRobotsResult = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/robots.txt",
  robotsUrl: "https://example.com/robots.txt",
  sitemaps: ["https://example.com/sitemap.xml"],
  groups: [
    {
      userAgents: ["*"],
      allow: ["/"],
      disallow: ["/private"],
      crawlDelay: undefined,
    },
  ],
  text: "User-agent: *\nAllow: /\nDisallow: /private",
};

const sampleSitemap: WebSitemapResult = {
  requestedUrl: "https://example.com/article",
  finalUrl: "https://example.com/sitemap.xml",
  sitemapUrl: "https://example.com/sitemap.xml",
  sitemaps: [],
  urls: ["https://example.com/article", "https://example.com/docs"],
  xml: "<urlset></urlset>",
};

const sampleCrawl: WebCrawlResult = {
  rootUrl: "https://example.com",
  settings: {
    maxPages: 10,
    maxDepth: 1,
    sameOrigin: true,
    include: undefined,
    exclude: undefined,
  },
  pages: [
    {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      title: "Home",
      description: "Home page",
      depth: 0,
    },
    {
      requestedUrl: "https://example.com/docs",
      finalUrl: "https://example.com/docs",
      title: "Docs",
      description: undefined,
      depth: 1,
    },
  ],
};

const createMockSearchEngine = (name: string): WebSearchEngine => {
  return {
    name,
    search: async ({ query, limit }) => {
      const allResults = [
        {
          title: `${name} result for ${query}`,
          url: `https://${name}.example.com/search?q=${encodeURIComponent(query)}`,
          description: `Top result from ${name}.`,
        },
        {
          title: `${name} docs for ${query}`,
          url: `https://${name}.example.com/docs?q=${encodeURIComponent(query)}`,
          description: undefined,
        },
      ] as const;

      return allResults.slice(0, limit);
    },
  };
};

const createTestServices = () => {
  const apiKeyOverrides: Array<string | undefined> = [];
  const readRequests: WebPageReadRequest[] = [];
  const services: CliServices = {
    createSearchEngineRegistry: (apiKeyOverride) => {
      apiKeyOverrides.push(apiKeyOverride);

      return createSearchEngineRegistry("brave", [
        createMockSearchEngine("brave"),
        createMockSearchEngine("alt"),
      ]);
    },
    webPageReader: {
      read: async (request) => {
        readRequests.push(request);

        return {
          ...samplePageContent,
          requestedUrl: request.url,
          finalUrl: request.url,
        };
      },
    },
    webPageInspector: {
      meta: async () => sampleMetadata,
      links: async () => sampleLinks,
      extract: async () => sampleExtract,
      code: async () => sampleCodeBlocks,
      tables: async () => sampleTables,
    },
    webDiscovery: {
      robots: async () => sampleRobots,
      sitemap: async () => sampleSitemap,
      crawl: async () => sampleCrawl,
    },
  };

  return {
    apiKeyOverrides,
    readRequests,
    services,
  };
};

const runWithCapturedIo = async (
  args: readonly string[],
  testServices: ReturnType<typeof createTestServices> = createTestServices(),
) => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(
    args,
    packageInfo,
    {
      stdout: (text) => {
        stdout.push(text);
      },
      stderr: (text) => {
        stderr.push(text);
      },
    },
    testServices.services,
  );

  return {
    apiKeyOverrides: testServices.apiKeyOverrides,
    exitCode,
    readRequests: testServices.readRequests,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
  };
};

describe("runCli", () => {
  it("shows help when no arguments are provided", async () => {
    const result = await runWithCapturedIo([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: devtools [options] [command]");
    expect(result.stdout).toContain("web             Web utilities");
    expect(result.stderr).toBe("");
  });

  it("shows the version", async () => {
    const result = await runWithCapturedIo(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.1.0\n");
  });

  it("shows help for the web command", async () => {
    const result = await runWithCapturedIo(["web", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: devtools web [options] [command]");
    expect(result.stdout).toContain("search [options] <query>");
    expect(result.stdout).toContain("read [options] <url>");
    expect(result.stderr).toBe("");
  });

  it("shows help for the web search command", async () => {
    const result = await runWithCapturedIo(["web", "search", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: devtools web search [options] <query>",
    );
    expect(result.stdout).toContain("--api-key <key>");
    expect(result.stderr).toBe("");
  });

  it("shows help for the web read command", async () => {
    const result = await runWithCapturedIo(["web", "read", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: devtools web read [options] <url>");
    expect(result.stdout).toContain("--format <format>");
    expect(result.stderr).toBe("");
  });

  it("greets the provided name", async () => {
    const result = await runWithCapturedIo(["hello", "Alice"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello, Alice!\n");
  });

  it("searches the web with the default engine", async () => {
    const result = await runWithCapturedIo(["web", "search", "typescript"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1. brave result for typescript");
    expect(result.apiKeyOverrides).toEqual([undefined, undefined]);
  });

  it("supports overriding the api key via a command option", async () => {
    const result = await runWithCapturedIo([
      "web",
      "search",
      "typescript",
      "--api-key",
      "secret-key",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.apiKeyOverrides).toEqual([undefined, "secret-key"]);
  });

  it("reads a web page as markdown by default", async () => {
    const result = await runWithCapturedIo([
      "web",
      "read",
      "https://example.com/article",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("# Heading\n\nParagraph text.\n");
    expect(result.readRequests).toEqual([
      {
        url: "https://example.com/article",
        timeoutMs: 10_000,
      },
    ]);
  });

  it("returns metadata as json by default", async () => {
    const result = await runWithCapturedIo([
      "web",
      "meta",
      "https://example.com/article",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      title: "Example page",
      canonicalUrl: "https://example.com/article",
    });
  });

  it("returns links as markdown", async () => {
    const result = await runWithCapturedIo([
      "web",
      "links",
      "https://example.com/article",
      "--format",
      "markdown",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("- [Docs](https://example.com/docs)");
  });

  it("extracts content with a selector", async () => {
    const result = await runWithCapturedIo([
      "web",
      "extract",
      "https://example.com/article",
      "--selector",
      ".main",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Main section\n");
  });

  it("extracts code blocks as json", async () => {
    const result = await runWithCapturedIo([
      "web",
      "code",
      "https://example.com/article",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      blocks: [
        {
          language: "ts",
          code: "console.log('hello');",
        },
      ],
    });
  });

  it("extracts tables as markdown", async () => {
    const result = await runWithCapturedIo([
      "web",
      "tables",
      "https://example.com/article",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("| Name | Value |");
  });

  it("fetches robots data", async () => {
    const result = await runWithCapturedIo([
      "web",
      "robots",
      "https://example.com/article",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      robotsUrl: "https://example.com/robots.txt",
    });
  });

  it("fetches sitemap urls as text", async () => {
    const result = await runWithCapturedIo([
      "web",
      "sitemap",
      "https://example.com",
      "--format",
      "text",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("https://example.com/article");
  });

  it("crawls a site as text", async () => {
    const result = await runWithCapturedIo([
      "web",
      "crawl",
      "https://example.com",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("https://example.com/");
    expect(result.stdout).toContain("Home");
  });

  it("rejects invalid read urls with zod validation", async () => {
    const result = await runWithCapturedIo(["web", "read", "not-a-url"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - url: URL must be a valid absolute URL.",
    );
  });

  it("rejects invalid selectors with zod validation", async () => {
    const result = await runWithCapturedIo([
      "web",
      "extract",
      "https://example.com/article",
      "--selector",
      "   ",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - options.selector: Selector must not be empty.",
    );
  });

  it("rejects conflicting link filters", async () => {
    const result = await runWithCapturedIo([
      "web",
      "links",
      "https://example.com/article",
      "--internal-only",
      "--external-only",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - options.internalOnly: Cannot combine internalOnly and externalOnly.",
    );
  });

  it("rejects invalid crawl depths", async () => {
    const result = await runWithCapturedIo([
      "web",
      "crawl",
      "https://example.com",
      "--max-depth",
      "-1",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - options.maxDepth: Max depth must be greater than or equal to 0.",
    );
  });

  it("returns an error for an unknown command", async () => {
    const result = await runWithCapturedIo(["unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'unknown'");
  });
});
