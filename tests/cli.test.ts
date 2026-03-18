import { describe, expect, it } from "vitest";

import { type createDefaultCliServices, runCli } from "#app/cli/index.ts";
import type { createFetchWebPageReader } from "#app/web/fetch.ts";
import { createSearchEngineRegistry } from "#app/web/search.ts";

type WebPageContent = Awaited<
  ReturnType<ReturnType<typeof createFetchWebPageReader>["read"]>
>;
type WebPageReadRequest = Parameters<
  ReturnType<typeof createFetchWebPageReader>["read"]
>[0];
type WebSearchEngine = Parameters<typeof createSearchEngineRegistry>[1][number];

const packageInfo = {
  name: "devtools",
  version: "0.1.0",
} as const;

const samplePageContent = {
  requestedUrl: "https://example.com/requested",
  finalUrl: "https://example.com/final",
  title: "Example page",
  excerpt: "Example excerpt",
  byline: "Jane Doe",
  siteName: "Example",
  text: "Heading\n\nParagraph text.",
  html: "<article><h1>Heading</h1><p>Paragraph text.</p></article>",
  markdown: "# Heading\n\nParagraph text.",
} satisfies WebPageContent;

const createMockSearchEngine = (name: string) => {
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
  } satisfies WebSearchEngine;
};

const createTestServices = () => {
  const apiKeyOverrides: Array<string | undefined> = [];
  const readRequests: WebPageReadRequest[] = [];
  const services: ReturnType<typeof createDefaultCliServices> = {
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
    expect(result.stdout).toContain("fetch [options] <url>");
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

  it("shows help for the web fetch command", async () => {
    const result = await runWithCapturedIo(["web", "fetch", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: devtools web fetch [options] <url>",
    );
    expect(result.stdout).toContain("--format <format>");
    expect(result.stderr).toBe("");
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

  it("fetches a web page as markdown by default", async () => {
    const result = await runWithCapturedIo([
      "web",
      "fetch",
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

  it("supports json output for fetched pages", async () => {
    const result = await runWithCapturedIo([
      "web",
      "fetch",
      "https://example.com/article",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalUrl: "https://example.com/article",
      title: "Example page",
    });
  });

  it("supports html output for fetched pages", async () => {
    const result = await runWithCapturedIo([
      "web",
      "fetch",
      "https://example.com/article",
      "--format",
      "html",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "<article><h1>Heading</h1><p>Paragraph text.</p></article>\n",
    );
  });

  it("rejects blank search queries with zod validation", async () => {
    const result = await runWithCapturedIo(["web", "search", "   "]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: - query: Query must not be empty.");
  });

  it("rejects invalid search limits with zod validation", async () => {
    const result = await runWithCapturedIo([
      "web",
      "search",
      "typescript",
      "--limit",
      "0",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - options.limit: Limit must be greater than 0.",
    );
  });

  it("rejects invalid fetch urls with zod validation", async () => {
    const result = await runWithCapturedIo(["web", "fetch", "not-a-url"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - url: URL must be a valid absolute URL.",
    );
  });

  it("rejects invalid fetch timeouts with zod validation", async () => {
    const result = await runWithCapturedIo([
      "web",
      "fetch",
      "https://example.com/article",
      "--timeout",
      "0",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - options.timeout: Timeout must be greater than 0.",
    );
  });

  it("returns an error for an unknown search engine", async () => {
    const result = await runWithCapturedIo([
      "web",
      "search",
      "typescript",
      "--engine",
      "missing",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown search engine: missing");
    expect(result.stderr).toContain("Available engines: alt, brave");
  });

  it("returns an error for an unknown command", async () => {
    const result = await runWithCapturedIo(["unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error: unknown command 'unknown'");
  });
});
