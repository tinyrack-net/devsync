import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startWebFixtureServer,
  type WebFixtureServer,
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

  it("shows help for nested web commands", async () => {
    const webHelpResult = await runCli(["web", "--help"]);
    const searchHelpResult = await runCli(["web", "search", "--help"]);
    const fetchHelpResult = await runCli(["web", "fetch", "--help"]);

    expect(webHelpResult.exitCode).toBe(0);
    expect(webHelpResult.stdout).toContain(
      "Usage: devtools web [options] [command]",
    );
    expect(searchHelpResult.exitCode).toBe(0);
    expect(searchHelpResult.stdout).toContain(
      "Usage: devtools web search [options] <query>",
    );
    expect(fetchHelpResult.exitCode).toBe(0);
    expect(fetchHelpResult.stdout).toContain(
      "Usage: devtools web fetch [options] <url>",
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

  it("fetches a local fixture page as markdown", async () => {
    const result = await runCli([
      "web",
      "fetch",
      `${webFixtureServer.baseUrl}/article`,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Primary heading");
    expect(result.stdout).toContain("Alpha paragraph.");
    expect(result.stderr).toBe("");
  });

  it("fetches a local fixture page as json", async () => {
    const result = await runCli([
      "web",
      "fetch",
      `${webFixtureServer.baseUrl}/article`,
      "--format",
      "json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalUrl: `${webFixtureServer.baseUrl}/article`,
      title: "Fixture OG Title",
      markdown: expect.stringContaining("Primary heading"),
    });
    expect(result.stderr).toBe("");
  });

  it("shows a validation error for an invalid fetch url", async () => {
    const result = await runCli(["web", "fetch", "not-a-url"], {
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "error: - url: URL must be a valid absolute URL.",
    );
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
