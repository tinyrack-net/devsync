import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInitialSyncConfig,
  formatSyncConfig,
} from "../src/config/sync.ts";
import { cliNodeOptions } from "../src/test/helpers/cli-entry.ts";
import {
  createSyncE2EContext,
  type SyncE2EContext,
} from "../src/test/helpers/e2e-context.ts";
import { createPtySession } from "../src/test/helpers/pty.ts";
import { stripAnsi } from "../src/test/helpers/sync-fixture.ts";

let ctx: SyncE2EContext;
const supportsPtyE2E = process.platform !== "win32";
const itWithPty = it.skipIf(!supportsPtyE2E);

beforeEach(async () => {
  ctx = await createSyncE2EContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

const runCliStreaming = async (
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
) => {
  const child = spawn(process.execPath, [...cliNodeOptions, ...args], {
    env: {
      ...process.env,
      ...ctx.baseEnv,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCodePromise = new Promise<number>((resolve, reject) => {
    child.on("close", (code) => {
      resolve(code ?? -1);
    });
    child.on("error", reject);
  });

  const firstStdout = await new Promise<string>((resolve, reject) => {
    const onData = (chunk: string) => {
      cleanup();
      resolve(chunk);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Process exited before emitting progress output."));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
    };

    child.stdout.on("data", onData);
    child.on("close", onClose);
    child.on("error", onError);
  });
  const exitCode = await exitCodePromise;

  return {
    exitCode,
    firstStdout,
    stderr,
    stdout,
  };
};

describe("sync CLI e2e", () => {
  it("generates a default age identity for bare init", async () => {
    const result = await ctx.runCli(["init"], {
      env: { ...ctx.baseEnv },
    });

    expect(result.stdout).toContain("age: generated a new local identity");
    expect(
      await readFile(
        join(ctx.homeDir, ".config", "devsync", "keys.txt"),
        "utf8",
      ),
    ).toContain("AGE-SECRET-KEY-");
    expect(
      JSON.parse(
        await readFile(join(ctx.xdgDir, "devsync", "settings.jsonc"), "utf8"),
      ),
    ).toMatchObject({
      activeProfile: "default",
      version: 3,
    });
    expect(
      JSON.parse(
        await readFile(join(ctx.xdgDir, "devsync", "settings.jsonc"), "utf8"),
      ),
    ).not.toHaveProperty("age");
    expect(
      JSON.parse(
        await readFile(
          join(ctx.xdgDir, "devsync", "repository", "manifest.jsonc"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      age: {
        recipients: [expect.stringMatching(/^age1/u)],
      },
      entries: [],
      version: 7,
    });
    expect(
      await readFile(
        join(ctx.xdgDir, "devsync", "repository", ".gitattributes"),
        "utf8",
      ),
    ).toBe("* -text\n");
  });

  it("accepts a supplied age key during init without a precreated identity file", async () => {
    const sourceRepository = join(ctx.workspace, "remote-sync");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.runGit(["init", "-b", "main", sourceRepository]);

    const result = await ctx.runCli([
      "init",
      sourceRepository,
      "--key",
      ageKeys.identity,
    ]);

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).toContain("age: using existing identity");
    expect(
      await readFile(
        join(ctx.homeDir, ".config", "devsync", "keys.txt"),
        "utf8",
      ),
    ).toBe(`${ageKeys.identity}\n`);
  });

  itWithPty(
    "fails when importing an existing repository without supplying an age key",
    async () => {
      const sourceRepository = join(ctx.workspace, "remote-sync");

      await ctx.runGit(["init", "-b", "main", sourceRepository]);
      const session = createPtySession({
        args: [...cliNodeOptions, "init", sourceRepository],
        cwd: ctx.workspace,
        env: {
          ...ctx.baseEnv,
        },
        file: process.execPath,
      });

      try {
        await session.waitFor(
          "Enter the age private key for the existing repository",
          10_000,
        );
        session.write("\r");

        const output = await session.waitFor(
          "Provide your existing age private key with '--key' or '--promptKey'.",
          10_000,
        );

        expect(output).toContain(
          "Existing repository setup requires an age private key",
        );
      } finally {
        session.close();
      }
    },
  );

  it("does not warn about an existing config when cloning a repository with an existing manifest", async () => {
    const sourceRepository = join(ctx.workspace, "remote-sync");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.runGit(["init", "-b", "main", sourceRepository]);
    await writeFile(
      join(sourceRepository, "manifest.jsonc"),
      formatSyncConfig(
        createInitialSyncConfig({
          recipients: [ageKeys.recipient],
        }),
      ),
      "utf8",
    );
    await ctx.runGit(["add", "manifest.jsonc"], sourceRepository);
    await ctx.runGit(
      ["commit", "-m", "initial manifest", "--author", "test <test@test.com>"],
      sourceRepository,
    );

    const result = await ctx.runCli([
      "init",
      sourceRepository,
      "--key",
      ageKeys.identity,
    ]);

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).not.toContain(
      "Sync directory already initialized",
    );
  });

  it("rejects an invalid supplied age key during init", async () => {
    const result = await ctx.runCli(["init", "--key", "not-a-key"], {
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).toContain("Invalid age private key");
  });

  it("accepts an age key via --key when no identity file exists", async () => {
    const sourceRepository = join(ctx.workspace, "remote-sync");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.runGit(["init", "-b", "main", sourceRepository]);

    const result = await ctx.runCli([
      "init",
      sourceRepository,
      "--key",
      ageKeys.identity,
    ]);

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(
      await readFile(
        join(ctx.homeDir, ".config", "devsync", "keys.txt"),
        "utf8",
      ),
    ).toBe(`${ageKeys.identity}\n`);
  });

  it("does not warn about an existing config when cloning a repository with an existing manifest and passing the key via --key", async () => {
    const sourceRepository = join(ctx.workspace, "remote-sync");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.runGit(["init", "-b", "main", sourceRepository]);
    await writeFile(
      join(sourceRepository, "manifest.jsonc"),
      formatSyncConfig(
        createInitialSyncConfig({
          recipients: [ageKeys.recipient],
        }),
      ),
      "utf8",
    );
    await ctx.runGit(["add", "manifest.jsonc"], sourceRepository);
    await ctx.runGit(
      ["commit", "-m", "initial manifest", "--author", "test <test@test.com>"],
      sourceRepository,
    );

    const result = await ctx.runCli([
      "init",
      sourceRepository,
      "--key",
      ageKeys.identity,
    ]);

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).not.toContain(
      "Sync directory already initialized",
    );
  });

  itWithPty(
    "does not warn about an existing config when cloning a repository with an existing manifest and entering the key interactively",
    async () => {
      const sourceRepository = join(ctx.workspace, "remote-sync");
      const ageKeys = await ctx.createAgeKeyPair();

      await ctx.runGit(["init", "-b", "main", sourceRepository]);
      await writeFile(
        join(sourceRepository, "manifest.jsonc"),
        formatSyncConfig(
          createInitialSyncConfig({
            recipients: [ageKeys.recipient],
          }),
        ),
        "utf8",
      );
      await ctx.runGit(["add", "manifest.jsonc"], sourceRepository);
      await ctx.runGit(
        [
          "commit",
          "-m",
          "initial manifest",
          "--author",
          "test <test@test.com>",
        ],
        sourceRepository,
      );

      const session = createPtySession({
        args: [...cliNodeOptions, "init", "--prompt-key", sourceRepository],
        cwd: ctx.workspace,
        env: {
          ...ctx.baseEnv,
        },
        file: process.execPath,
      });

      try {
        await session.waitFor(
          "Enter the age private key for the existing repository",
          10_000,
        );
        session.write(`${ageKeys.identity}\r`);

        const output = await session.waitFor(
          "Sync directory initialized",
          10_000,
        );

        expect(output).not.toContain("Sync directory already initialized");
      } finally {
        session.close();
      }
    },
  );

  itWithPty(
    "fails when an empty key is entered interactively for an existing repository",
    async () => {
      const sourceRepository = join(ctx.workspace, "remote-sync");

      await ctx.runGit(["init", "-b", "main", sourceRepository]);

      const session = createPtySession({
        args: [...cliNodeOptions, "init", "--prompt-key", sourceRepository],
        cwd: ctx.workspace,
        env: {
          ...ctx.baseEnv,
        },
        file: process.execPath,
      });

      try {
        await session.waitFor(
          "Enter the age private key for the existing repository",
          10_000,
        );
        session.write("\r");

        const output = await session.waitFor(
          "Existing repository setup requires an age private key",
          10_000,
        );

        expect(output).toContain(
          "Provide your existing age private key with '--key' or '--promptKey'.",
        );
      } finally {
        session.close();
      }
    },
  );

  it("tracks roots, sets modes, and untracks from the CLI", async () => {
    const bundleDirectory = join(ctx.homeDir, ".config", "mytool");
    const publicFile = join(bundleDirectory, "public.json");
    const cacheDirectory = join(bundleDirectory, "cache");
    const syncDirectory = join(ctx.xdgDir, "devsync", "repository");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(publicFile, "{}\n");
    await writeFile(join(cacheDirectory, "state.txt"), "cache\n");

    await ctx.runCli(["init"]);

    const trackResult = await ctx.runCli([
      "track",
      bundleDirectory,
      "--mode",
      "secret",
    ]);
    const exactRuleResult = await ctx.runCli([
      "track",
      publicFile,
      "--mode",
      "normal",
    ]);
    const subtreeRuleResult = await ctx.runCli([
      "track",
      cacheDirectory,
      "--mode",
      "ignore",
    ]);
    const configAfterSet = JSON.parse(
      await readFile(join(syncDirectory, "manifest.jsonc"), "utf8"),
    ) as {
      entries: Array<{
        kind: string;
        localPath: { default: string };
        mode?: { default: string };
      }>;
    };

    expect(stripAnsi(trackResult.stdout)).toContain(
      "Started tracking .config/mytool",
    );
    expect(stripAnsi(trackResult.stdout)).toContain("mode: secret");
    expect(stripAnsi(exactRuleResult.stdout)).toContain(
      "Started tracking .config/mytool/public.json",
    );
    expect(stripAnsi(subtreeRuleResult.stdout)).toContain("mode: ignore");
    expect(configAfterSet.entries).toMatchObject([
      {
        kind: "directory",
        localPath: { default: "~/.config/mytool" },
        mode: { default: "secret" },
      },
      {
        kind: "directory",
        localPath: { default: "~/.config/mytool/cache" },
        mode: { default: "ignore" },
      },
      {
        kind: "file",
        localPath: { default: "~/.config/mytool/public.json" },
      },
    ]);

    const untrackResult = await ctx.runCli(["untrack", ".config/mytool"]);

    expect(stripAnsi(untrackResult.stdout)).toContain(
      "Stopped tracking .config/mytool",
    );

    await ctx.runCli(["untrack", ".config/mytool/cache"]);
    await ctx.runCli(["untrack", ".config/mytool/public.json"]);

    const configAfterUntrack = JSON.parse(
      await readFile(join(syncDirectory, "manifest.jsonc"), "utf8"),
    ) as {
      entries: unknown[];
    };

    expect(configAfterUntrack.entries).toEqual([]);
  }, 15_000);

  it("syncs with the default profile namespace using push and pull", async () => {
    const zshDirectory = join(ctx.homeDir, ".config", "zsh");
    const sharedFile = join(zshDirectory, "zshrc");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(sharedFile, "export PATH=$PATH:$HOME/bin\n");
    await writeFile(secretsFile, "export TOKEN=work\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", zshDirectory]);
    await ctx.runCli(["track", secretsFile, "--mode", "secret"]);

    await ctx.runCli(["push"]);

    expect(
      await readFile(
        join(
          ctx.xdgDir,
          "devsync",
          "repository",
          "default",
          ".config",
          "zsh",
          "zshrc",
        ),
        "utf8",
      ),
    ).toContain("PATH");
    expect(
      await readFile(
        join(
          ctx.xdgDir,
          "devsync",
          "repository",
          "default",
          ".config",
          "zsh",
          "secrets.zsh.devsync.secret",
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");

    await writeFile(secretsFile, "local-change\n");
    await ctx.runCli(["pull", "-y"]);

    expect(await readFile(secretsFile, "utf8")).toContain("TOKEN=work");
  }, 15_000);

  it("sets mode on tracked roots via track command", async () => {
    const bundleDirectory = join(ctx.homeDir, ".config", "mytool");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", bundleDirectory]);

    const result = await ctx.runCli([
      "track",
      bundleDirectory,
      "--mode",
      "secret",
    ]);

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain(
      "Updated tracking for .config/mytool",
    );
    expect(stripAnsi(result.stdout)).toContain("mode: secret");
  });

  it("streams push progress to stdout before the command exits", async () => {
    const bundleDirectory = join(ctx.homeDir, ".config", "streaming");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });

    for (let index = 0; index < 150; index += 1) {
      await writeFile(
        join(bundleDirectory, `file-${String(index).padStart(3, "0")}.txt`),
        `value-${index}\n`,
        "utf8",
      );
    }

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", bundleDirectory]);

    const result = await runCliStreaming(["push", "--verbose"]);

    expect(
      result.exitCode,
      `push exited with ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
    expect(stripAnsi(result.firstStdout)).toContain("Starting push...");
    expect(stripAnsi(result.stdout)).toContain("Scanning local files...");
    expect(stripAnsi(result.stdout)).toContain("Push complete");
  });

  it("previews push changes without writing artifacts when --dry-run is used", async () => {
    const configDir = join(ctx.homeDir, ".config", "dryapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "mode = dry\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);

    const result = await ctx.runCli(["push", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("Push preview");
    expect(stripAnsi(result.stdout)).toContain("dry run");

    // The artifact should NOT have been written to the repository
    const artifact = join(
      ctx.xdgDir,
      "devsync",
      "repository",
      "default",
      ".config",
      "dryapp",
      "config.toml",
    );
    await expect(readFile(artifact, "utf8")).rejects.toThrow();
  });

  it("previews pull changes without overwriting local files when --dry-run is used", async () => {
    const configDir = join(ctx.homeDir, ".config", "pullapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "version = 1\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);

    // Modify the local file so it diverges from the repository
    await writeFile(configFile, "version = 2\n");

    const result = await ctx.runCli(["pull", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("Pull preview");
    expect(stripAnsi(result.stdout)).toContain("dry run");

    // Local file should still have the modified content
    expect(await readFile(configFile, "utf8")).toContain("version = 2");
  });

  it("prints that there are no pull changes and exits without prompting", async () => {
    const configDir = join(ctx.homeDir, ".config", "steadyapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "version = 1\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);

    const result = await ctx.runCli(["pull"]);

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("Already up to date");
  });

  it.skipIf(process.platform !== "win32")(
    "treats opposite Windows text line endings as unchanged during pull",
    async () => {
      const sourceRepository = join(ctx.workspace, "remote-sync");
      const configDir = join(ctx.homeDir, ".config", "line-endings-clean");
      const configFile = join(configDir, "config.toml");
      const reverseFile = join(configDir, "reverse.toml");
      const ageKeys = await ctx.createAgeKeyPair();

      await mkdir(
        join(sourceRepository, "default", ".config", "line-endings-clean"),
        {
          recursive: true,
        },
      );
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(sourceRepository, "manifest.jsonc"),
        formatSyncConfig({
          ...createInitialSyncConfig({
            recipients: [ageKeys.recipient],
          }),
          entries: [
            {
              kind: "directory",
              localPath: {
                default: "~/.config/line-endings-clean",
              },
              mode: {
                default: "normal",
              },
            },
          ],
        }),
        "utf8",
      );
      await writeFile(
        join(
          sourceRepository,
          "default",
          ".config",
          "line-endings-clean",
          "config.toml",
        ),
        "version = 1\r\nname = test\r\n",
        "utf8",
      );
      await writeFile(
        join(
          sourceRepository,
          "default",
          ".config",
          "line-endings-clean",
          "reverse.toml",
        ),
        "version = 1\nname = test\n",
        "utf8",
      );
      await writeFile(configFile, "version = 1\nname = test\n", "utf8");
      await writeFile(reverseFile, "version = 1\r\nname = test\r\n", "utf8");
      await ctx.runGit(["init", "-b", "main"], sourceRepository);
      await ctx.runGit(["add", "."], sourceRepository);
      await ctx.runGit(
        ["commit", "-m", "seed normalized line endings"],
        sourceRepository,
      );

      await ctx.runCli(["init", sourceRepository, "--key", ageKeys.identity]);
      const result = await ctx.runCli(["pull"]);

      expect(result.exitCode).toBe(0);
      expect(stripAnsi(result.stdout)).toContain("Already up to date");
      expect(stripAnsi(result.stdout)).not.toContain("Planned pull changes");
    },
  );

  it.skipIf(process.platform !== "win32")(
    "normalizes Windows text line endings without hiding BOM changes during pull",
    async () => {
      const sourceRepository = join(ctx.workspace, "remote-sync");
      const configDir = join(ctx.homeDir, ".config", "line-endings-bom");
      const configFile = join(configDir, "config.toml");
      const bomFile = join(configDir, "bom.toml");
      const ageKeys = await ctx.createAgeKeyPair();

      await mkdir(
        join(sourceRepository, "default", ".config", "line-endings-bom"),
        {
          recursive: true,
        },
      );
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(sourceRepository, "manifest.jsonc"),
        formatSyncConfig({
          ...createInitialSyncConfig({
            recipients: [ageKeys.recipient],
          }),
          entries: [
            {
              kind: "directory",
              localPath: {
                default: "~/.config/line-endings-bom",
              },
              mode: {
                default: "normal",
              },
            },
          ],
        }),
        "utf8",
      );
      await writeFile(
        join(
          sourceRepository,
          "default",
          ".config",
          "line-endings-bom",
          "config.toml",
        ),
        "version = 1\r\nname = test\r\n",
        "utf8",
      );
      await writeFile(
        join(
          sourceRepository,
          "default",
          ".config",
          "line-endings-bom",
          "bom.toml",
        ),
        "\uFEFFversion = 1\r\n",
        "utf8",
      );
      await writeFile(configFile, "version = 1\nname = test\n", "utf8");
      await writeFile(bomFile, "version = 1\n", "utf8");
      await ctx.runGit(["init", "-b", "main"], sourceRepository);
      await ctx.runGit(["add", "."], sourceRepository);
      await ctx.runGit(
        ["commit", "-m", "seed normalized line endings"],
        sourceRepository,
      );

      await ctx.runCli(["init", sourceRepository, "--key", ageKeys.identity]);
      const result = await ctx.runCli(["pull"], { reject: false });

      expect(result.exitCode).not.toBe(0);
      expect(stripAnsi(result.stdout)).toContain("Planned pull changes");
      expect(stripAnsi(result.stdout)).toContain("bom.toml");
      expect(stripAnsi(result.stdout)).not.toContain("config.toml");
    },
  );

  it("fails in non-interactive mode without -y when pull changes exist", async () => {
    const configDir = join(ctx.homeDir, ".config", "noninteractive-pull");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "version = 1\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);
    await writeFile(configFile, "version = 2\n");

    const result = await ctx.runCli(["pull"], { reject: false });

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).toContain(
      "Pull confirmation requires an interactive terminal.",
    );
    expect(stripAnsi(result.stderr)).toContain("devsync pull -y");
    expect(await readFile(configFile, "utf8")).toContain("version = 2");
  });

  itWithPty("cancels pull interactively unless y is entered", async () => {
    const configDir = join(ctx.homeDir, ".config", "interactive-pull");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "version = 1\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);
    await writeFile(configFile, "version = 2\n");

    const session = createPtySession({
      args: [...cliNodeOptions, "pull"],
      cwd: ctx.workspace,
      env: {
        ...ctx.baseEnv,
      },
      file: process.execPath,
    });

    try {
      const output = await session.waitFor(
        "Apply these changes? [y/N]",
        10_000,
      );

      expect(output).toContain(configFile);
      session.write("n\r");

      const cancelledOutput = await session.waitFor(
        "Skipped pull changes",
        10_000,
      );

      expect(cancelledOutput).toContain(configFile);
      expect(await readFile(configFile, "utf8")).toContain("version = 2");
    } finally {
      session.close();
    }
  });

  itWithPty("applies pull interactively when y is entered", async () => {
    const configDir = join(ctx.homeDir, ".config", "interactive-accept");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "version = 1\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);
    await writeFile(configFile, "version = 2\n");

    const session = createPtySession({
      args: [...cliNodeOptions, "pull"],
      cwd: ctx.workspace,
      env: {
        ...ctx.baseEnv,
      },
      file: process.execPath,
    });

    try {
      const output = await session.waitFor(
        "Apply these changes? [y/N]",
        10_000,
      );

      expect(output).toContain(configFile);
      session.write("y\r");

      const appliedOutput = await session.waitFor("Pull complete", 10_000);

      expect(appliedOutput).toContain(configFile);
      expect(await readFile(configFile, "utf8")).toContain("version = 1");
    } finally {
      session.close();
    }
  });

  it("returns a non-zero exit code when pushing without init", async () => {
    const result = await ctx.runCli(["push"], { reject: false });

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).not.toBe("");
  });

  it("returns a non-zero exit code when pulling without init", async () => {
    const result = await ctx.runCli(["pull"], { reject: false });

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).not.toBe("");
  });

  it("deletes local files that were removed from repository during pull", async () => {
    const appDirectory = join(ctx.homeDir, ".config", "testapp");
    const configFile = join(appDirectory, "config.yaml");
    const dataFile = join(appDirectory, "data.json");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(configFile, "setting: value\n");
    await writeFile(dataFile, '{"data": true}\n');

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", appDirectory]);
    await ctx.runCli(["push"]);

    const repoConfigFile = join(
      ctx.xdgDir,
      "devsync",
      "repository",
      "default",
      ".config",
      "testapp",
      "config.yaml",
    );
    const repoDataFile = join(
      ctx.xdgDir,
      "devsync",
      "repository",
      "default",
      ".config",
      "testapp",
      "data.json",
    );

    expect(await readFile(repoConfigFile, "utf8")).toContain("setting: value");
    expect(await readFile(repoDataFile, "utf8")).toContain('"data": true');

    await rm(repoDataFile);

    const result = await ctx.runCli(["pull", "-y"]);

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("remove");
    expect(await readFile(configFile, "utf8")).toContain("setting: value");
    await expect(readFile(dataFile, "utf8")).rejects.toThrow();
  });

  it("deletes multiple local files when they are removed from repository", async () => {
    const notesDirectory = join(ctx.homeDir, ".config", "notes");
    const note1 = join(notesDirectory, "todo.txt");
    const note2 = join(notesDirectory, "ideas.txt");
    const note3 = join(notesDirectory, "reminders.txt");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(notesDirectory, { recursive: true });
    await writeFile(note1, "Buy milk\n");
    await writeFile(note2, "New app idea\n");
    await writeFile(note3, "Call mom\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", notesDirectory]);
    await ctx.runCli(["push"]);

    const repoNote2 = join(
      ctx.xdgDir,
      "devsync",
      "repository",
      "default",
      ".config",
      "notes",
      "ideas.txt",
    );
    const repoNote3 = join(
      ctx.xdgDir,
      "devsync",
      "repository",
      "default",
      ".config",
      "notes",
      "reminders.txt",
    );

    await rm(repoNote2);
    await rm(repoNote3);

    const result = await ctx.runCli(["pull", "-y"]);

    expect(result.exitCode).toBe(0);
    expect(await readFile(note1, "utf8")).toContain("Buy milk");
    await expect(readFile(note2, "utf8")).rejects.toThrow();
    await expect(readFile(note3, "utf8")).rejects.toThrow();
  });
});
