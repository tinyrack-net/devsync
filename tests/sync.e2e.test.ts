import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

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
        await readFile(join(xdgConfigHome, "devsync", "settings.json"), "utf8"),
      ),
    ).toMatchObject({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [expect.stringMatching(/^age1/u)],
      },
      version: 2,
    });
    expect(
      JSON.parse(
        await readFile(
          join(xdgConfigHome, "devsync", "sync", "manifest.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      entries: [],
      version: 5,
    });
  });

  it("prints the sync directory via dir command", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const result = await runCli(["dir"], {
      env: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    expect(result.stdout).toBe(`${join(xdgConfigHome, "devsync", "sync")}`);
  });

  it("tracks roots, sets modes, and untracks from the CLI", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "mytool");
    const publicFile = join(bundleDirectory, "public.json");
    const cacheDirectory = join(bundleDirectory, "cache");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
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
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );

    const trackResult = await runCli(
      ["track", bundleDirectory, "--mode", "secret"],
      {
        env,
      },
    );
    const exactRuleResult = await runCli(["mode", publicFile, "normal"], {
      env,
    });
    const subtreeRuleResult = await runCli(
      ["mode", cacheDirectory, "ignore", "--recursive"],
      { env },
    );
    const configAfterSet = JSON.parse(
      await readFile(join(syncDirectory, "manifest.json"), "utf8"),
    ) as {
      entries: Array<{
        kind: string;
        localPath: string;
        mode?: string;
      }>;
    };

    expect(trackResult.stdout).toContain("Tracked sync target.");
    expect(trackResult.stdout).toContain("Mode: secret");
    expect(exactRuleResult.stdout).toContain("Action: added");
    expect(subtreeRuleResult.stdout).toContain("Action: added");
    expect(configAfterSet.entries).toMatchObject([
      {
        kind: "directory",
        localPath: "~/.config/mytool",
        mode: "secret",
      },
      {
        kind: "directory",
        localPath: "~/.config/mytool/cache",
        mode: "ignore",
      },
      {
        kind: "file",
        localPath: "~/.config/mytool/public.json",
      },
    ]);

    const untrackResult = await runCli(["untrack", ".config/mytool"], { env });

    expect(untrackResult.stdout).toContain("Untracked sync target.");

    await runCli(["untrack", ".config/mytool/cache"], { env });
    await runCli(["untrack", ".config/mytool/public.json"], { env });

    const configAfterUntrack = JSON.parse(
      await readFile(join(syncDirectory, "manifest.json"), "utf8"),
    ) as {
      entries: unknown[];
    };

    expect(configAfterUntrack.entries).toEqual([]);
  }, 15_000);

  it("syncs with the default machine namespace using push and pull", async () => {
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
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["track", zshDirectory], { env });
    await runCli(["mode", secretsFile, "secret"], { env });

    await runCli(["push"], { env });

    expect(
      await readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
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
          "sync",
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

  it("sets mode on tracked roots via the mode command", async () => {
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
        "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      ],
      { env },
    );
    await runCli(["track", bundleDirectory], { env });

    const result = await runCli(["mode", bundleDirectory, "secret"], {
      env,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Mode: secret");
  });
});
