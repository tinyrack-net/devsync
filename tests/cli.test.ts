import { describe, expect, it } from "vitest";

import { type createDefaultCliServices, runCli } from "#app/cli/index.ts";
import type { createSkillInstaller } from "#app/skills/install.ts";
import type { createFetchWebPageReader } from "#app/web/fetch.ts";
import type { createWebPageInspector } from "#app/web/inspect.ts";
import type { createWebPageLinkReader } from "#app/web/links.ts";
import { createSearchEngineRegistry } from "#app/web/search.ts";
import type { createWebSitemapReader } from "#app/web/sitemap.ts";

type WebPageContent = Awaited<
  ReturnType<ReturnType<typeof createFetchWebPageReader>["read"]>
>;
type WebPageReadRequest = Parameters<
  ReturnType<typeof createFetchWebPageReader>["read"]
>[0];
type WebPageInspection = Awaited<
  ReturnType<ReturnType<typeof createWebPageInspector>["inspect"]>
>;
type WebPageInspectRequest = Parameters<
  ReturnType<typeof createWebPageInspector>["inspect"]
>[0];
type WebPageLinks = Awaited<
  ReturnType<ReturnType<typeof createWebPageLinkReader>["read"]>
>;
type WebPageLinksRequest = Parameters<
  ReturnType<typeof createWebPageLinkReader>["read"]
>[0];
type WebSitemap = Awaited<
  ReturnType<ReturnType<typeof createWebSitemapReader>["read"]>
>;
type WebSitemapRequest = Parameters<
  ReturnType<typeof createWebSitemapReader>["read"]
>[0];
type SkillInstallResult = Awaited<
  ReturnType<ReturnType<typeof createSkillInstaller>["install"]>
>;
type WebSearchEngine = Parameters<typeof createSearchEngineRegistry>[1][number];

const packageInfo = {
  name: "devtools",
  version: "0.1.0",
} as const;

const samplePageContent = {
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

const sampleLinks = {
  requestedUrl: "https://example.com/requested",
  finalUrl: "https://example.com/final",
  canonicalUrl: "https://example.com/canonical",
  sameOriginOnly: false,
  links: [
    {
      kind: "same-origin",
      url: "https://example.com/docs",
      texts: ["Docs", "Docs duplicate"],
      rel: [],
      targets: [],
      occurrences: 2,
    },
    {
      kind: "external",
      url: "https://external.example.com/path",
      texts: ["External link"],
      rel: ["noopener"],
      targets: ["_blank"],
      occurrences: 1,
    },
  ],
} satisfies WebPageLinks;

const sampleSitemap = {
  requestedUrl: "https://example.com",
  sitemapUrls: ["https://example.com/sitemap.xml"],
  sameOriginOnly: false,
  urls: [
    {
      url: "https://example.com/",
      lastModified: undefined,
    },
    {
      url: "https://example.com/docs",
      lastModified: "2025-03-18",
    },
  ],
} satisfies WebSitemap;

const sampleSkillInstallResult = {
  agent: "pi",
  dryRun: false,
  skillsDirectory: "/workspace/devtools/skills",
  targetDirectory: "/home/example/.pi/agent/skills",
  installedSkills: [
    {
      name: "web-research",
      sourcePath: "/workspace/devtools/skills/web-research",
      targetPath: "/home/example/.pi/agent/skills/web-research",
      status: "installed",
    },
  ],
} satisfies SkillInstallResult;

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
  const inspectRequests: WebPageInspectRequest[] = [];
  const installRequests: Array<{
    agent: "pi";
    dryRun: boolean;
    force: boolean;
    targetDirectory?: string;
  }> = [];
  const linkRequests: WebPageLinksRequest[] = [];
  const readRequests: WebPageReadRequest[] = [];
  const sitemapRequests: WebSitemapRequest[] = [];
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
    skillInstaller: {
      install: async (request) => {
        installRequests.push(request);
        return {
          ...sampleSkillInstallResult,
          agent: request.agent,
          dryRun: request.dryRun,
          targetDirectory:
            request.targetDirectory ?? sampleSkillInstallResult.targetDirectory,
          installedSkills: sampleSkillInstallResult.installedSkills.map(
            (skill) => {
              return {
                ...skill,
                status: request.dryRun ? "would-install" : skill.status,
              };
            },
          ),
        };
      },
    },
    webPageInspector: {
      inspect: async (request) => {
        inspectRequests.push(request);
        return {
          ...sampleInspection,
          requestedUrl: request.url,
          finalUrl: request.url,
        };
      },
    },
    webPageLinkReader: {
      read: async (request) => {
        linkRequests.push(request);
        return {
          ...sampleLinks,
          requestedUrl: request.url,
          finalUrl: request.url,
          sameOriginOnly: request.sameOriginOnly,
        };
      },
    },
    webSitemapReader: {
      read: async (request) => {
        sitemapRequests.push(request);
        return {
          ...sampleSitemap,
          requestedUrl: request.url,
          sameOriginOnly: request.sameOriginOnly,
        };
      },
    },
  };

  return {
    apiKeyOverrides,
    inspectRequests,
    installRequests,
    linkRequests,
    readRequests,
    services,
    sitemapRequests,
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
    inspectRequests: testServices.inspectRequests,
    installRequests: testServices.installRequests,
    linkRequests: testServices.linkRequests,
    readRequests: testServices.readRequests,
    sitemapRequests: testServices.sitemapRequests,
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

  it("shows help for the install command", async () => {
    const result = await runWithCapturedIo(["install", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: devtools install [options] [command]",
    );
    expect(result.stdout).toContain("skills [options] <agent>");
    expect(result.stderr).toBe("");
  });

  it("shows help for the web command", async () => {
    const result = await runWithCapturedIo(["web", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: devtools web [options] [command]");
    expect(result.stdout).toContain("search [options] <query>");
    expect(result.stdout).toContain("docs-search [options] <site> <query>");
    expect(result.stdout).toContain("fetch [options] <url>");
    expect(result.stdout).toContain("inspect [options] <url>");
    expect(result.stdout).toContain("links [options] <url>");
    expect(result.stdout).toContain("sitemap [options] <url>");
    expect(result.stderr).toBe("");
  });

  it("shows help for the web search command", async () => {
    const result = await runWithCapturedIo(["web", "search", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: devtools web search [options] <query>",
    );
    expect(result.stdout).toContain("--api-key <key>");
    expect(result.stdout).toContain("--site <site>");
    expect(result.stderr).toBe("");
  });

  it("shows help for install skills", async () => {
    const result = await runWithCapturedIo(["install", "skills", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Usage: devtools install skills [options] <agent>",
    );
    expect(result.stdout).toContain("--target-dir <path>");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--force");
  });

  it("shows help for the new web commands", async () => {
    const inspectHelp = await runWithCapturedIo(["web", "inspect", "--help"]);
    const linksHelp = await runWithCapturedIo(["web", "links", "--help"]);
    const sitemapHelp = await runWithCapturedIo(["web", "sitemap", "--help"]);
    const docsSearchHelp = await runWithCapturedIo([
      "web",
      "docs-search",
      "--help",
    ]);

    expect(inspectHelp.exitCode).toBe(0);
    expect(inspectHelp.stdout).toContain(
      "Usage: devtools web inspect [options] <url>",
    );
    expect(linksHelp.exitCode).toBe(0);
    expect(linksHelp.stdout).toContain(
      "Usage: devtools web links [options] <url>",
    );
    expect(sitemapHelp.exitCode).toBe(0);
    expect(sitemapHelp.stdout).toContain(
      "Usage: devtools web sitemap [options] <url>",
    );
    expect(docsSearchHelp.exitCode).toBe(0);
    expect(docsSearchHelp.stdout).toContain(
      "Usage: devtools web docs-search [options] <site> <query>",
    );
  });

  it("installs bundled skills for pi", async () => {
    const result = await runWithCapturedIo([
      "install",
      "skills",
      "pi",
      "--target-dir",
      "/tmp/pi-skills",
      "--force",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Installed 1 skills for pi.");
    expect(result.installRequests).toEqual([
      {
        agent: "pi",
        dryRun: false,
        force: true,
        targetDirectory: "/tmp/pi-skills",
      },
    ]);
  });

  it("supports dry-run skill installation", async () => {
    const result = await runWithCapturedIo([
      "install",
      "skills",
      "pi",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Dry run for pi: 1 skills evaluated.");
    expect(result.stdout).toContain("No filesystem changes were made.");
    expect(result.installRequests).toEqual([
      {
        agent: "pi",
        dryRun: true,
        force: false,
      },
    ]);
  });

  it("searches the web with the default engine", async () => {
    const result = await runWithCapturedIo(["web", "search", "typescript"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1. brave result for typescript");
    expect(result.apiKeyOverrides).toEqual([undefined, undefined, undefined]);
  });

  it("supports restricting search results to a site", async () => {
    const result = await runWithCapturedIo([
      "web",
      "search",
      "typescript",
      "--site",
      "nodejs.org/docs",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      query: "typescript",
      searchQuery: "site:nodejs.org/docs typescript",
      site: "nodejs.org/docs",
    });
  });

  it("supports docs-search as a specialized site-restricted search", async () => {
    const result = await runWithCapturedIo([
      "web",
      "docs-search",
      "https://nodejs.org/docs/latest/",
      "fs watch",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      query: "fs watch",
      searchQuery: "site:nodejs.org/docs/latest fs watch",
      site: "nodejs.org/docs/latest",
    });
  });

  it("supports docs-search text output", async () => {
    const result = await runWithCapturedIo([
      "web",
      "docs-search",
      "nodejs.org/docs",
      "worker threads",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "1. brave result for site:nodejs.org/docs worker threads",
    );
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
    expect(result.apiKeyOverrides).toEqual([
      undefined,
      undefined,
      "secret-key",
    ]);
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
      canonicalUrl: "https://example.com/canonical",
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

  it("supports inspecting a web page", async () => {
    const result = await runWithCapturedIo([
      "web",
      "inspect",
      "https://example.com/article",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalUrl: "https://example.com/article",
      title: "Example page",
    });
    expect(result.inspectRequests).toEqual([
      {
        url: "https://example.com/article",
        timeoutMs: 10_000,
      },
    ]);
  });

  it("supports extracting normalized links", async () => {
    const result = await runWithCapturedIo([
      "web",
      "links",
      "https://example.com/article",
      "--same-origin",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalUrl: "https://example.com/article",
      sameOriginOnly: true,
    });
    expect(result.linkRequests).toEqual([
      {
        url: "https://example.com/article",
        timeoutMs: 10_000,
        sameOriginOnly: true,
      },
    ]);
  });

  it("supports reading sitemap urls", async () => {
    const result = await runWithCapturedIo([
      "web",
      "sitemap",
      "https://example.com",
      "--same-origin",
      "--concurrency",
      "2",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestedUrl: "https://example.com",
      sameOriginOnly: true,
    });
    expect(result.sitemapRequests).toEqual([
      {
        url: "https://example.com",
        timeoutMs: 10_000,
        sameOriginOnly: true,
        concurrency: 2,
      },
    ]);
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

  it("rejects unsupported skill install agents", async () => {
    const result = await runWithCapturedIo(["install", "skills", "codex"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid input: expected "pi"');
  });

  it("rejects invalid search sites with zod validation", async () => {
    const result = await runWithCapturedIo([
      "web",
      "search",
      "typescript",
      "--site",
      "http://",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - options.site: Site must be a valid hostname or absolute URL.",
    );
  });

  it("rejects invalid fetch urls with zod validation", async () => {
    const result = await runWithCapturedIo(["web", "fetch", "not-a-url"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "error: - url: URL must be a valid absolute URL.",
    );
  });

  it("rejects invalid inspect timeouts with zod validation", async () => {
    const result = await runWithCapturedIo([
      "web",
      "inspect",
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
