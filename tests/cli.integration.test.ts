import {
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SupportedSkillInstallAgent } from "#app/skills/agents.ts";
import {
  startWebFixtureServer,
  type WebFixtureServer,
} from "./helpers/web-fixture-server.ts";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const bundledSkillPath = fileURLToPath(
  new URL("../skills/web-research", import.meta.url),
);
const defaultTargetDirectories = {
  pi: [".pi", "agent", "skills"],
  codex: [".agents", "skills"],
  claude: [".claude", "skills"],
  opencode: [".config", "opencode", "skills"],
} satisfies Record<SupportedSkillInstallAgent, readonly string[]>;

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

  it("shows help for install, uninstall, and nested web commands", async () => {
    const installHelpResult = await runCli(["install", "skills", "--help"]);
    const uninstallHelpResult = await runCli(["uninstall", "skills", "--help"]);
    const webHelpResult = await runCli(["web", "--help"]);
    const searchHelpResult = await runCli(["web", "search", "--help"]);
    const fetchHelpResult = await runCli(["web", "fetch", "--help"]);
    const inspectHelpResult = await runCli(["web", "inspect", "--help"]);
    const linksHelpResult = await runCli(["web", "links", "--help"]);
    const sitemapHelpResult = await runCli(["web", "sitemap", "--help"]);

    expect(installHelpResult.exitCode).toBe(0);
    expect(installHelpResult.stdout).toContain(
      "Usage: devtools install skills [options] <agent>",
    );
    expect(installHelpResult.stdout).toContain("pi");
    expect(installHelpResult.stdout).toContain("codex");
    expect(installHelpResult.stdout).toContain("claude");
    expect(installHelpResult.stdout).toContain("opencode");
    expect(uninstallHelpResult.exitCode).toBe(0);
    expect(uninstallHelpResult.stdout).toContain(
      "Usage: devtools uninstall skills [options] <agent>",
    );
    expect(uninstallHelpResult.stdout).toContain("pi");
    expect(uninstallHelpResult.stdout).toContain("codex");
    expect(uninstallHelpResult.stdout).toContain("claude");
    expect(uninstallHelpResult.stdout).toContain("opencode");

    expect(webHelpResult.exitCode).toBe(0);
    expect(webHelpResult.stdout).toContain(
      "Usage: devtools web [options] [command]",
    );
    expect(webHelpResult.stdout).toContain(
      "docs-search [options] <site> <query>",
    );
    expect(webHelpResult.stdout).toContain("inspect [options] <url>");
    expect(webHelpResult.stdout).toContain("links [options] <url>");
    expect(webHelpResult.stdout).toContain("sitemap [options] <url>");
    expect(searchHelpResult.exitCode).toBe(0);
    expect(searchHelpResult.stdout).toContain(
      "Usage: devtools web search [options] <query>",
    );
    expect(fetchHelpResult.exitCode).toBe(0);
    expect(fetchHelpResult.stdout).toContain(
      "Usage: devtools web fetch [options] <url>",
    );
    expect(inspectHelpResult.exitCode).toBe(0);
    expect(inspectHelpResult.stdout).toContain(
      "Usage: devtools web inspect [options] <url>",
    );
    expect(linksHelpResult.exitCode).toBe(0);
    expect(linksHelpResult.stdout).toContain(
      "Usage: devtools web links [options] <url>",
    );
    expect(sitemapHelpResult.exitCode).toBe(0);
    expect(sitemapHelpResult.stdout).toContain(
      "Usage: devtools web sitemap [options] <url>",
    );
  });

  it("installs bundled pi skills into a target directory", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "devtools-skills-"));

    try {
      const result = await runCli([
        "install",
        "skills",
        "pi",
        "--target-dir",
        targetDirectory,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Installed 1 skills for pi.");
      expect(result.stderr).toBe("");

      const entries = (await readdir(targetDirectory)).sort((left, right) => {
        return left.localeCompare(right);
      });

      expect(entries).toEqual(["web-research"]);

      const skillLinkPath = join(targetDirectory, "web-research");
      const linkStats = await lstat(skillLinkPath);

      expect(linkStats.isSymbolicLink()).toBe(true);
      expect(await realpath(skillLinkPath)).toBe(bundledSkillPath);
      expect(await readFile(join(skillLinkPath, "SKILL.md"), "utf8")).toContain(
        "name: web-research",
      );
      expect(
        await readFile(
          join(skillLinkPath, "references", "commands.md"),
          "utf8",
        ),
      ).toContain("Web Command Reference");
    } finally {
      await rm(targetDirectory, { force: true, recursive: true });
    }
  });

  it("installs bundled pi skills into PI_CODING_AGENT_DIR when set", async () => {
    const workspaceDirectory = await mkdtemp(join(tmpdir(), "devtools-agent-"));
    const agentDirectory = join(workspaceDirectory, "agent");

    try {
      const result = await runCli(["install", "skills", "pi"], {
        env: {
          PI_CODING_AGENT_DIR: agentDirectory,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        `Target directory: ${join(agentDirectory, "skills")}`,
      );
      expect(
        await realpath(join(agentDirectory, "skills", "web-research")),
      ).toBe(bundledSkillPath);
    } finally {
      await rm(workspaceDirectory, { force: true, recursive: true });
    }
  });

  it.each(
    Object.entries(defaultTargetDirectories).filter(([agent]) => {
      return agent !== "pi";
    }) as Array<[SupportedSkillInstallAgent, readonly string[]]>,
  )("installs and uninstalls bundled %s skills in the default user-global directory", async (agent, targetSegments) => {
    const homeDirectory = await mkdtemp(
      join(tmpdir(), `devtools-home-${agent}-`),
    );
    const expectedTargetDirectory = join(homeDirectory, ...targetSegments);

    try {
      const installResult = await runCli(["install", "skills", agent], {
        env: {
          HOME: homeDirectory,
        },
      });

      expect(installResult.exitCode).toBe(0);
      expect(installResult.stdout).toContain(
        `Installed 1 skills for ${agent}.`,
      );
      expect(installResult.stdout).toContain(
        `Target directory: ${expectedTargetDirectory}`,
      );
      expect(
        await realpath(join(expectedTargetDirectory, "web-research")),
      ).toBe(bundledSkillPath);

      const uninstallResult = await runCli(["uninstall", "skills", agent], {
        env: {
          HOME: homeDirectory,
        },
      });

      expect(uninstallResult.exitCode).toBe(0);
      expect(uninstallResult.stdout).toContain(
        `Removed 1 skills for ${agent}.`,
      );
      await expect(
        lstat(join(expectedTargetDirectory, "web-research")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("supports dry-run skill installation without creating files", async () => {
    const workspaceDirectory = await mkdtemp(
      join(tmpdir(), "devtools-dry-run-"),
    );
    const targetDirectory = join(workspaceDirectory, "skills-target");

    try {
      const result = await runCli([
        "install",
        "skills",
        "pi",
        "--target-dir",
        targetDirectory,
        "--dry-run",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Dry run for pi: 1 skills evaluated.");
      expect(result.stdout).toContain("No filesystem changes were made.");
      await expect(lstat(targetDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(workspaceDirectory, { force: true, recursive: true });
    }
  });

  it("uninstalls bundled pi skills from a target directory", async () => {
    const targetDirectory = await mkdtemp(join(tmpdir(), "devtools-remove-"));

    try {
      await runCli([
        "install",
        "skills",
        "pi",
        "--target-dir",
        targetDirectory,
      ]);

      const result = await runCli([
        "uninstall",
        "skills",
        "pi",
        "--target-dir",
        targetDirectory,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Removed 1 skills for pi.");
      await expect(
        lstat(join(targetDirectory, "web-research")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(targetDirectory, { force: true, recursive: true });
    }
  });

  it("supports dry-run skill uninstallation without removing files", async () => {
    const targetDirectory = await mkdtemp(
      join(tmpdir(), "devtools-remove-dry-"),
    );

    try {
      await runCli([
        "install",
        "skills",
        "pi",
        "--target-dir",
        targetDirectory,
      ]);

      const result = await runCli([
        "uninstall",
        "skills",
        "pi",
        "--target-dir",
        targetDirectory,
        "--dry-run",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "Dry run for pi uninstall: 1 skills evaluated.",
      );
      expect(await realpath(join(targetDirectory, "web-research"))).toBe(
        bundledSkillPath,
      );
    } finally {
      await rm(targetDirectory, { force: true, recursive: true });
    }
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
      canonicalUrl: `${webFixtureServer.baseUrl}/article`,
      title: "Fixture OG Title",
      markdown: expect.stringContaining("Primary heading"),
    });
    expect(result.stderr).toBe("");
  });

  it("inspects a local fixture page as json", async () => {
    const result = await runCli([
      "web",
      "inspect",
      `${webFixtureServer.baseUrl}/article`,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalUrl: `${webFixtureServer.baseUrl}/article`,
      canonicalUrl: `${webFixtureServer.baseUrl}/article`,
      title: "Fixture Article",
      description: "Fixture description",
      language: "en",
    });
    expect(result.stderr).toBe("");
  });

  it("extracts normalized links from a local fixture page", async () => {
    const result = await runCli([
      "web",
      "links",
      `${webFixtureServer.baseUrl}/article`,
      "--same-origin",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      finalUrl: `${webFixtureServer.baseUrl}/article`,
      sameOriginOnly: true,
      links: expect.arrayContaining([
        expect.objectContaining({
          kind: "same-origin",
          url: `${webFixtureServer.baseUrl}/docs`,
          occurrences: 2,
        }),
      ]),
    });
    expect(result.stderr).toBe("");
  });

  it("reads sitemap urls from a local fixture site", async () => {
    const result = await runCli([
      "web",
      "sitemap",
      webFixtureServer.baseUrl,
      "--same-origin",
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requestedUrl: `${webFixtureServer.baseUrl}/`,
      sameOriginOnly: true,
      sitemapUrls: [`${webFixtureServer.baseUrl}/sitemap.xml`],
      urls: expect.arrayContaining([
        expect.objectContaining({ url: `${webFixtureServer.baseUrl}/` }),
        expect.objectContaining({ url: `${webFixtureServer.baseUrl}/article` }),
      ]),
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
