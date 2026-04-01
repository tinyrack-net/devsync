import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  createInitialSyncConfig,
  formatSyncConfig,
} from "../src/config/sync.ts";
import { cliNodeOptions } from "../src/test/helpers/cli-entry.ts";
import { createPtySession } from "../src/test/helpers/pty.ts";
import {
  createAgeKeyPair,
  createShellRecorderEnvironment,
  createTemporaryDirectory,
  gitTestEnvironment,
  stripAnsi,
  writeIdentityFile,
} from "../src/test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-sync-cli-");

  temporaryDirectories.push(directory);

  return directory;
};

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    reject?: boolean;
  }>,
) => {
  return execa(process.execPath, [...cliNodeOptions, ...args], {
    cwd: options?.cwd,
    env: options?.env,
    input: options?.input,
    reject: options?.reject,
  });
};

const runCliStreaming = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }>,
) => {
  const child = spawn(process.execPath, [...cliNodeOptions, ...args], {
    cwd: options?.cwd,
    env: {
      ...process.env,
      ...options?.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      NODE_NO_WARNINGS: "1",
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

const createSyncEnvironment = (
  homeDirectory: string,
  xdgConfigHome: string,
): NodeJS.ProcessEnv => {
  return {
    HOME: homeDirectory,
    XDG_CONFIG_HOME: xdgConfigHome,
  };
};

const runGit = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }>,
) => {
  return execa("git", [...args], {
    cwd: options?.cwd,
    env: {
      ...process.env,
      ...gitTestEnvironment,
      ...options?.env,
    },
  });
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("sync CLI e2e", () => {
  it("generates a default age identity for bare init", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const result = await runCli(["init"], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      input: "\n",
    });

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).toContain(
      "age: generated a new local identity",
    );
    expect(
      await readFile(join(xdgConfigHome, "devsync", "keys.txt"), "utf8"),
    ).toContain("AGE-SECRET-KEY-");
    expect(
      JSON.parse(
        await readFile(join(xdgConfigHome, "devsync", "settings.json"), "utf8"),
      ),
    ).toMatchObject({
      activeProfile: "default",
      version: 3,
    });
    expect(
      JSON.parse(
        await readFile(join(xdgConfigHome, "devsync", "settings.json"), "utf8"),
      ),
    ).not.toHaveProperty("age");
    expect(
      JSON.parse(
        await readFile(
          join(xdgConfigHome, "devsync", "repository", "manifest.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: [expect.stringMatching(/^age1/u)],
      },
      entries: [],
      version: 7,
    });
  });

  it("accepts a supplied age key during init without a precreated identity file", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], {
      cwd: workspace,
    });

    const result = await runCli(
      ["init", sourceRepository, "--key", ageKeys.identity],
      {
        env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      },
    );

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).toContain("age: using existing identity");
    expect(
      await readFile(join(xdgConfigHome, "devsync", "keys.txt"), "utf8"),
    ).toBe(`${ageKeys.identity}\n`);
  });

  it("does not warn about an existing config when cloning a repository with an existing manifest", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], {
      cwd: workspace,
    });
    await writeFile(
      join(sourceRepository, "manifest.json"),
      formatSyncConfig(
        createInitialSyncConfig({
          identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
          recipients: [ageKeys.recipient],
        }),
      ),
      "utf8",
    );
    await runGit(["add", "manifest.json"], {
      cwd: sourceRepository,
    });
    await runGit(
      ["commit", "-m", "initial manifest", "--author", "test <test@test.com>"],
      {
        cwd: sourceRepository,
        env: {
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_AUTHOR_NAME: "Test User",
          GIT_COMMITTER_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test User",
        },
      },
    );

    const result = await runCli(
      ["init", sourceRepository, "--key", ageKeys.identity],
      {
        env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      },
    );

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).not.toContain(
      "Sync directory already initialized",
    );
  });

  it("rejects an invalid supplied age key during init", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const result = await runCli(["init", "--key", "not-a-key"], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).toContain("Invalid age private key");
  });

  it("reads the init age key from stdin when --key is omitted", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], {
      cwd: workspace,
    });

    const result = await runCli(["init", sourceRepository], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      input: `${ageKeys.identity}\n`,
    });

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(
      await readFile(join(xdgConfigHome, "devsync", "keys.txt"), "utf8"),
    ).toBe(`${ageKeys.identity}\n`);
  });

  it("does not warn about an existing config when cloning a repository with an existing manifest and reading the key from stdin", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], {
      cwd: workspace,
    });
    await writeFile(
      join(sourceRepository, "manifest.json"),
      formatSyncConfig(
        createInitialSyncConfig({
          identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
          recipients: [ageKeys.recipient],
        }),
      ),
      "utf8",
    );
    await runGit(["add", "manifest.json"], {
      cwd: sourceRepository,
    });
    await runGit(
      ["commit", "-m", "initial manifest", "--author", "test <test@test.com>"],
      {
        cwd: sourceRepository,
        env: {
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_AUTHOR_NAME: "Test User",
          GIT_COMMITTER_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test User",
        },
      },
    );

    const result = await runCli(["init", sourceRepository], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      input: `${ageKeys.identity}\n`,
    });

    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(stripAnsi(result.stdout)).not.toContain(
      "Sync directory already initialized",
    );
  });

  it("does not warn about an existing config when cloning a repository with an existing manifest and entering the key interactively", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], {
      cwd: workspace,
    });
    await writeFile(
      join(sourceRepository, "manifest.json"),
      formatSyncConfig(
        createInitialSyncConfig({
          identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
          recipients: [ageKeys.recipient],
        }),
      ),
      "utf8",
    );
    await runGit(["add", "manifest.json"], {
      cwd: sourceRepository,
    });
    await runGit(
      ["commit", "-m", "initial manifest", "--author", "test <test@test.com>"],
      {
        cwd: sourceRepository,
        env: {
          GIT_AUTHOR_EMAIL: "test@example.com",
          GIT_AUTHOR_NAME: "Test User",
          GIT_COMMITTER_EMAIL: "test@example.com",
          GIT_COMMITTER_NAME: "Test User",
        },
      },
    );

    const session = createPtySession({
      args: [...cliNodeOptions, "init", sourceRepository],
      cwd: workspace,
      env: {
        ...createSyncEnvironment(homeDirectory, xdgConfigHome),
        FORCE_COLOR: "0",
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
      },
      file: process.execPath,
    });

    try {
      await session.waitFor("Enter an age private key", 10_000);
      session.write(`${ageKeys.identity}\r`);

      const output = await session.waitFor(
        "Sync directory initialized",
        10_000,
      );

      expect(output).not.toContain("Sync directory already initialized");
    } finally {
      session.close();
    }
  });

  it("launches a shell in the sync directory via cd command", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const markerFile = join(workspace, "shell-marker.txt");
    const result = await runCli(["cd"], {
      env: {
        ...createSyncEnvironment(homeDirectory, xdgConfigHome),
        ...(await createShellRecorderEnvironment(workspace, markerFile)),
      },
    });

    expect(result.stdout).toBe("");
    expect(await readFile(markerFile, "utf8")).toBe(
      join(xdgConfigHome, "devsync", "repository"),
    );
  });

  it("tracks roots, sets modes, and untracks from the CLI", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "mytool");
    const publicFile = join(bundleDirectory, "public.json");
    const cacheDirectory = join(bundleDirectory, "cache");
    const syncDirectory = join(xdgConfigHome, "devsync", "repository");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(publicFile, "{}\n");
    await writeFile(join(cacheDirectory, "state.txt"), "cache\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/keys.txt",
      ],
      { env },
    );

    const trackResult = await runCli(
      ["track", bundleDirectory, "--mode", "secret"],
      {
        env,
      },
    );
    const exactRuleResult = await runCli(
      ["track", publicFile, "--mode", "normal"],
      { env },
    );
    const subtreeRuleResult = await runCli(
      ["track", cacheDirectory, "--mode", "ignore"],
      { env },
    );
    const configAfterSet = JSON.parse(
      await readFile(join(syncDirectory, "manifest.json"), "utf8"),
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

    const untrackResult = await runCli(["untrack", ".config/mytool"], { env });

    expect(stripAnsi(untrackResult.stdout)).toContain(
      "Stopped tracking .config/mytool",
    );

    await runCli(["untrack", ".config/mytool/cache"], { env });
    await runCli(["untrack", ".config/mytool/public.json"], { env });

    const configAfterUntrack = JSON.parse(
      await readFile(join(syncDirectory, "manifest.json"), "utf8"),
    ) as {
      entries: unknown[];
    };

    expect(configAfterUntrack.entries).toEqual([]);
  }, 15_000);

  it("syncs with the default profile namespace using push and pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const sharedFile = join(zshDirectory, "zshrc");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(sharedFile, "export PATH=$PATH:$HOME/bin\n");
    await writeFile(secretsFile, "export TOKEN=work\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/keys.txt",
      ],
      { env },
    );
    await runCli(["track", zshDirectory], { env });
    await runCli(["track", secretsFile, "--mode", "secret"], { env });

    await runCli(["push"], { env });

    expect(
      await readFile(
        join(
          xdgConfigHome,
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
          xdgConfigHome,
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
    await runCli(["pull"], { env });

    expect(await readFile(secretsFile, "utf8")).toContain("TOKEN=work");
  }, 15_000);

  it("sets mode on tracked roots via track command", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "mytool");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/keys.txt",
      ],
      { env },
    );
    await runCli(["track", bundleDirectory], { env });

    const result = await runCli(
      ["track", bundleDirectory, "--mode", "secret"],
      {
        env,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain(
      "Updated tracking for .config/mytool",
    );
    expect(stripAnsi(result.stdout)).toContain("mode: secret");
  });

  it("streams push progress to stdout before the command exits", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "streaming");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });

    for (let index = 0; index < 150; index += 1) {
      await writeFile(
        join(bundleDirectory, `file-${String(index).padStart(3, "0")}.txt`),
        `value-${index}\n`,
        "utf8",
      );
    }

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/keys.txt",
      ],
      { env },
    );
    await runCli(["track", bundleDirectory], { env });

    const result = await runCliStreaming(["push", "--verbose"], { env });

    expect(
      result.exitCode,
      `push exited with ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
    expect(stripAnsi(result.firstStdout)).toContain("Starting push...");
    expect(stripAnsi(result.stdout)).toContain("Scanning local files...");
    expect(stripAnsi(result.stdout)).toContain("Push complete");
  });
});
