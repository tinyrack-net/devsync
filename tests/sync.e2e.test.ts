import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import { syncSecretArtifactSuffix } from "#app/config/sync.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../src/test/helpers/sync-fixture.ts";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
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
    reject?: boolean;
  }>,
) => {
  return execa(process.execPath, [cliPath, ...args], {
    cwd: options?.cwd,
    env: options?.env,
    reject: options?.reject,
  });
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
    });

    expect(result.stdout).toContain("Initialized sync directory.");
    expect(result.stdout).toContain(
      "Age bootstrap: generated a new local identity.",
    );
    expect(
      await readFile(join(xdgConfigHome, "devsync", "age", "keys.txt"), "utf8"),
    ).toContain("AGE-SECRET-KEY-");
    expect(
      JSON.parse(
        await readFile(
          join(xdgConfigHome, "devsync", "sync", "config.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [expect.stringMatching(/^age1/u)],
      },
    });
  });

  it("prints the sync directory in non-interactive mode", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const result = await runCli(["cd"], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    expect(result.stdout).toBe(`${join(xdgConfigHome, "devsync", "sync")}`);
  });

  it("adds, sets, and forgets tracked sync targets from the CLI", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "mytool");
    const publicFile = join(bundleDirectory, "public.json");
    const cacheDirectory = join(bundleDirectory, "cache");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();

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
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      {
        env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      },
    );

    const addResult = await runCli(["add", bundleDirectory, "--secret"], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const setExactResult = await runCli(["set", "normal", publicFile], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const setSubtreeResult = await runCli(
      ["set", "ignore", cacheDirectory, "--recursive"],
      {
        env: createSyncEnvironment(homeDirectory, xdgConfigHome),
      },
    );
    const configAfterSet = JSON.parse(
      await readFile(join(syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: Array<{
        kind: string;
        localPath: string;
        mode: string;
        overrides?: Record<string, string>;
        repoPath: string;
      }>;
    };

    expect(addResult.stdout).toContain("Added sync target.");
    expect(addResult.stdout).toContain("Mode: secret");
    expect(setExactResult.stdout).toContain("Scope: exact rule");
    expect(setExactResult.stdout).toContain("Action: added");
    expect(setSubtreeResult.stdout).toContain("Scope: subtree rule");
    expect(configAfterSet.entries).toEqual([
      {
        kind: "directory",
        localPath: "~/.config/mytool",
        mode: "secret",
        overrides: {
          "cache/": "ignore",
          "public.json": "normal",
        },
        repoPath: ".config/mytool",
      },
    ]);
    expect("ignoreGlobs" in configAfterSet).toBe(false);
    expect("secretGlobs" in configAfterSet).toBe(false);

    const forgetResult = await runCli(["forget", ".config/mytool"], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const configAfterForget = JSON.parse(
      await readFile(join(syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: unknown[];
    };

    expect(forgetResult.stdout).toContain("Forgot sync target.");
    expect(configAfterForget.entries).toEqual([]);
  }, 15_000);

  it("resolves bare relative sync set targets from the current working directory", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sshDirectory = join(homeDirectory, ".ssh");
    const knownHostsFile = join(sshDirectory, "known_hosts");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(knownHostsFile, "github.com ssh-ed25519 AAAA...\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["add", sshDirectory, "--secret"], { env });

    const setResult = await runCli(["set", "ignore", "known_hosts"], {
      cwd: sshDirectory,
      env,
    });
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        repoPath: string;
        overrides?: Record<string, string>;
      }>;
    };

    expect(setResult.stdout).toContain("Owning entry: .ssh");
    expect(setResult.stdout).toContain(
      "Target repository path: .ssh/known_hosts",
    );
    expect(config.entries).toMatchObject([
      {
        repoPath: ".ssh",
        overrides: { known_hosts: "ignore" },
      },
    ]);
  });

  it("rejects profile-specific file tracking and root updates from the CLI", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const trackedFile = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(trackedFile, "[user]\n  name = profile\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    const addResult = await runCli(["add", trackedFile, "--profile", "work"], {
      env,
      reject: false,
    });

    await runCli(["add", trackedFile], { env });

    const setResult = await runCli(
      ["set", "secret", trackedFile, "--profile", "work"],
      { env, reject: false },
    );

    expect(addResult.stderr).toContain("Nonexistent flag: --profile");
    expect(setResult.stderr).toContain("not supported for file entries");
  });

  it("removes a profile-specific exact override when returning to the inherited mode", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=abc\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["add", zshDirectory], { env });
    await runCli(["set", "secret", secretsFile], { env });
    await runCli(["set", "ignore", secretsFile, "--profile", "vivident"], {
      env,
    });

    const setResult = await runCli(
      ["set", "secret", secretsFile, "--profile", "vivident"],
      { env },
    );
    const config = JSON.parse(
      await readFile(join(syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: Array<{
        overrides?: Record<string, string>;
        profiles?: {
          vivident?: { mode: string; overrides?: Record<string, string> };
        };
      }>;
    };

    expect(setResult.stdout).toContain("Updated sync mode.");
    expect(setResult.stdout).toContain("Action: removed");
    expect(config.entries[0]?.overrides).toEqual({ "secrets.zsh": "secret" });
    expect(config.entries[0]?.profiles?.vivident).toBeUndefined();
  });

  it("explains when a profile already inherits the requested mode", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=abc\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["add", zshDirectory], { env });
    await runCli(["set", "secret", secretsFile], { env });

    const setResult = await runCli(
      ["set", "secret", secretsFile, "--profile", "vivident"],
      { env },
    );

    expect(setResult.stdout).toContain("Sync mode unchanged.");
    expect(setResult.stdout).toContain("Action: unchanged");
    expect(setResult.stdout).toContain(
      "No override created because this target already inherits secret mode.",
    );
  });

  it("pushes and pulls through the CLI using per-path modes", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const plainFile = join(bundleDirectory, "plain.txt");
    const secretFile = join(bundleDirectory, "secret.json");
    const ignoredFile = join(bundleDirectory, "ignored.txt");
    const extraFile = join(bundleDirectory, "extra.txt");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain value\n");
    await writeFile(
      secretFile,
      JSON.stringify({ token: "cli-secret" }, null, 2),
    );
    await writeFile(ignoredFile, "keep local\n");

    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["add", bundleDirectory], { env });
    await runCli(["set", "secret", secretFile], { env });
    await runCli(["set", "ignore", ignoredFile], { env });

    const pushResult = await runCli(["push"], { env });

    expect(pushResult.stdout).toContain("Synchronized local config");
    expect(
      await readFile(
        join(syncDirectory, "files", "default", "bundle", "plain.txt"),
        "utf8",
      ),
    ).toBe("plain value\n");
    await expect(
      readFile(
        join(syncDirectory, "files", "default", "bundle", "ignored.txt"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(
        join(
          syncDirectory,
          "files",
          "default",
          "bundle",
          `secret.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");

    await writeFile(plainFile, "wrong value\n");
    await writeFile(
      secretFile,
      JSON.stringify({ token: "wrong-secret" }, null, 2),
    );
    await writeFile(ignoredFile, "preserve this\n");
    await writeFile(extraFile, "delete me\n");

    const pullResult = await runCli(["pull"], { env });

    expect(pullResult.stdout).toContain(
      "Applied sync repository to local config.",
    );
    expect(await readFile(plainFile, "utf8")).toBe("plain value\n");
    expect(await readFile(secretFile, "utf8")).toBe(
      `${JSON.stringify({ token: "cli-secret" }, null, 2)}`,
    );
    expect(await readFile(ignoredFile, "utf8")).toBe("preserve this\n");
    await expect(readFile(extraFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports set rejection for directory targets without --recursive", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const cacheDirectory = join(bundleDirectory, "cache");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(join(cacheDirectory, "state.txt"), "cache\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["add", bundleDirectory], { env });

    const result = await runCli(["set", "ignore", cacheDirectory], {
      env,
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Directory targets require --recursive");
    expect(result.stderr).toContain("Hint: Use '--recursive'");
  });

  it("reports corrupted secret repository artifacts on pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const secretFile = join(bundleDirectory, "secret.txt");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();
    const env = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(secretFile, "secret\n");

    await runCli(
      [
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["add", bundleDirectory], { env });
    await runCli(["set", "secret", secretFile], { env });
    await runCli(["push"], { env });
    await writeFile(
      join(
        syncDirectory,
        "files",
        "default",
        "bundle",
        `secret.txt${syncSecretArtifactSuffix}`,
      ),
      "not a valid age payload",
      "utf8",
    );

    const result = await runCli(["pull"], {
      env,
      reject: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Failed to decrypt a secret repository artifact.",
    );
    expect(result.stderr).toContain("Identity file:");
  });
});
