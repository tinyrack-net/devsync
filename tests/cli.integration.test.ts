import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type WebFixtureServer,
  startWebFixtureServer,
} from "./helpers/web-fixture-server.ts";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));

let webFixtureServer: WebFixtureServer;

beforeAll(async () => {
  webFixtureServer = await startWebFixtureServer();
});

afterAll(async () => {
  await webFixtureServer.close();
});

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    env?: NodeJS.ProcessEnv;
    reject?: boolean;
  }>,
) => {
  const execaOptions: {
    env?: NodeJS.ProcessEnv;
    reject?: boolean;
  } = {};

  if (options?.env !== undefined) {
    execaOptions.env = options.env;
  }

  if (options?.reject !== undefined) {
    execaOptions.reject = options.reject;
  }

  return execa(process.execPath, [cliPath, ...args], execaOptions);
};

describe("CLI integration", () => {
  it("shows the version from the real entrypoint", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0.1.0");
    expect(result.stderr).toBe("");
  });

  it("greets through the real entrypoint", async () => {
    const result = await runCli(["hello", "Alice"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello, Alice!");
    expect(result.stderr).toBe("");
  });

  it("shows help for nested web commands", async () => {
    const webHelpResult = await runCli(["web", "--help"]);
    const searchHelpResult = await runCli(["web", "search", "--help"]);
    const readHelpResult = await runCli(["web", "read", "--help"]);

    expect(webHelpResult.exitCode).toBe(0);
    expect(webHelpResult.stdout).toContain(
      "Usage: devtools web [options] [command]",
    );
    expect(searchHelpResult.exitCode).toBe(0);
    expect(searchHelpResult.stdout).toContain(
      "Usage: devtools web search [options] <query>",
    );
    expect(readHelpResult.exitCode).toBe(0);
    expect(readHelpResult.stdout).toContain(
      "Usage: devtools web read [options] <url>",
    );
  });

  it("shows a helpful error when the brave api key is missing", async () => {
    const result = await runCli(["web", "search", "typescript"], {
      env: {
        BRAVE_SEARCH_API_KEY: "",
      },
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "BRAVE_SEARCH_API_KEY is required for the brave search engine.",
    );
  });

  it("shows a validation error for an invalid search limit", async () => {
    const result = await runCli(
      ["web", "search", "typescript", "--limit", "0"],
      {
        reject: false,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "error: - options.limit: Limit must be greater than 0.",
    );
  });

  it("reads a local fixture page as markdown", async () => {
    const result = await runCli([
      "web",
      "read",
      `${webFixtureServer.baseUrl}/article`,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Primary heading");
    expect(result.stdout).toContain("Alpha paragraph.");
    expect(result.stderr).toBe("");
  });

  it("reads metadata from a local fixture page", async () => {
    const result = await runCli([
      "web",
      "meta",
      `${webFixtureServer.baseUrl}/article`,
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      title: "Fixture Article",
      description: "Fixture description",
      canonicalUrl: `${webFixtureServer.baseUrl}/article`,
      openGraph: {
        title: "Fixture OG Title",
      },
    });
    expect(result.stderr).toBe("");
  });

  it("extracts links from a local fixture page", async () => {
    const result = await runCli([
      "web",
      "links",
      `${webFixtureServer.baseUrl}/article`,
      "--format",
      "json",
      "--unique",
    ]);

    expect(result.exitCode).toBe(0);

    const parsedResult = JSON.parse(result.stdout) as {
      links: Array<{
        internal: boolean;
        url: string;
      }>;
    };

    expect(parsedResult.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: `${webFixtureServer.baseUrl}/ignored`,
          internal: true,
        }),
        expect.objectContaining({
          url: `${webFixtureServer.baseUrl}/docs`,
          internal: true,
        }),
        expect.objectContaining({
          url: "https://external.example.com/path",
          internal: false,
        }),
      ]),
    );
    expect(result.stderr).toBe("");
  });

  it("extracts selector matches from a local fixture page", async () => {
    const result = await runCli([
      "web",
      "extract",
      `${webFixtureServer.baseUrl}/article`,
      "--selector",
      ".item",
      "--all",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      selector: ".item",
      matches: [
        {
          text: "First item",
        },
        {
          text: "Second item",
        },
      ],
    });
    expect(result.stderr).toBe("");
  });

  it("extracts code blocks from a local fixture page", async () => {
    const result = await runCli([
      "web",
      "code",
      `${webFixtureServer.baseUrl}/article`,
      "--language",
      "ts",
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      blocks: [
        {
          language: "ts",
          code: "const answer = 42;",
        },
      ],
    });
    expect(result.stderr).toBe("");
  });

  it("extracts tables from a local fixture page", async () => {
    const result = await runCli([
      "web",
      "tables",
      `${webFixtureServer.baseUrl}/article`,
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      tables: [
        {
          caption: "Options",
          headers: ["Name", "Value"],
          rows: [["format", "json"]],
        },
      ],
    });
    expect(result.stderr).toBe("");
  });

  it("reads robots and sitemap data from a local fixture server", async () => {
    const robotsResult = await runCli([
      "web",
      "robots",
      `${webFixtureServer.baseUrl}/article`,
    ]);
    const sitemapResult = await runCli([
      "web",
      "sitemap",
      webFixtureServer.baseUrl,
    ]);

    expect(robotsResult.exitCode).toBe(0);
    expect(JSON.parse(robotsResult.stdout)).toMatchObject({
      robotsUrl: `${webFixtureServer.baseUrl}/robots.txt`,
      sitemaps: [`${webFixtureServer.baseUrl}/sitemap.xml`],
    });
    expect(sitemapResult.exitCode).toBe(0);
    expect(JSON.parse(sitemapResult.stdout)).toMatchObject({
      urls: [
        `${webFixtureServer.baseUrl}/`,
        `${webFixtureServer.baseUrl}/article`,
        `${webFixtureServer.baseUrl}/docs`,
      ],
    });
  });

  it("crawls a local fixture site", async () => {
    const result = await runCli([
      "web",
      "crawl",
      webFixtureServer.baseUrl,
      "--format",
      "json",
      "--max-pages",
      "2",
      "--max-depth",
      "1",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      pages: [
        {
          finalUrl: `${webFixtureServer.baseUrl}/`,
          title: "Fixture Home",
          depth: 0,
        },
        {
          finalUrl: `${webFixtureServer.baseUrl}/docs`,
          title: "Fixture Docs",
          depth: 1,
        },
      ],
    });
    expect(result.stderr).toBe("");
  });

  it("shows a validation error for an invalid read url", async () => {
    const result = await runCli(["web", "read", "not-a-url"], {
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "error: - url: URL must be a valid absolute URL.",
    );
  });

  it("shows a runtime error for an invalid selector", async () => {
    const result = await runCli(
      [
        "web",
        "extract",
        `${webFixtureServer.baseUrl}/article`,
        "--selector",
        "[",
      ],
      {
        reject: false,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error: Invalid selector: [");
  });

  it("returns a non-zero exit code for an unknown command", async () => {
    const result = await runCli(["unknown"], {
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("error: unknown command 'unknown'");
    expect(result.stderr).toContain("Usage: devtools [options] [command]");
  });
});
