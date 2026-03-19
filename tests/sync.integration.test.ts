import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
  writeJsonFile,
} from "./helpers/sync-fixture.ts";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devtools-sync-cli-");

  temporaryDirectories.push(directory);

  return directory;
};

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    env?: NodeJS.ProcessEnv;
    reject?: boolean;
  }>,
) => {
  return execa(process.execPath, [cliPath, ...args], {
    env: options?.env,
    reject: options?.reject,
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

describe("sync CLI integration", () => {
  it("generates a default age identity for bare sync init", async () => {
    const workspace = await createWorkspace();
    const xdgConfigHome = join(workspace, "xdg");
    const result = await runCli(["sync", "init"], {
      env: {
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    });

    expect(result.stdout).toContain("Initialized sync directory.");
    expect(result.stdout).toContain(
      "Age bootstrap: generated a new local identity.",
    );
    expect(
      await readFile(
        join(xdgConfigHome, "devtools", "age", "keys.txt"),
        "utf8",
      ),
    ).toContain("AGE-SECRET-KEY-");
    expect(
      JSON.parse(
        await readFile(
          join(xdgConfigHome, "devtools", "sync", "config.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
        recipients: [expect.stringMatching(/^age1/u)],
      },
    });
  });

  it("shows help for sync commands", async () => {
    const [
      topicHelp,
      addHelp,
      cdHelp,
      forgetHelp,
      initHelp,
      pushHelp,
      pullHelp,
    ] = await Promise.all([
      runCli(["sync", "--help"]),
      runCli(["sync", "add", "--help"]),
      runCli(["sync", "cd", "--help"]),
      runCli(["sync", "forget", "--help"]),
      runCli(["sync", "init", "--help"]),
      runCli(["sync", "push", "--help"]),
      runCli(["sync", "pull", "--help"]),
    ]);

    expect(topicHelp.stdout).toContain("$ devtools sync COMMAND");
    expect(topicHelp.stdout).toContain("sync add");
    expect(topicHelp.stdout).toContain("sync cd");
    expect(topicHelp.stdout).toContain("sync forget");
    expect(topicHelp.stdout).toContain("sync init");
    expect(topicHelp.stdout).toContain("sync push");
    expect(topicHelp.stdout).toContain("sync pull");
    expect(addHelp.stdout).toContain("$ devtools sync add TARGET");
    expect(cdHelp.stdout).toContain("$ devtools sync cd");
    expect(forgetHelp.stdout).toContain("$ devtools sync forget TARGET");
    expect(initHelp.stdout).toContain("$ devtools sync init [REPOSITORY]");
    expect(pushHelp.stdout).toContain("$ devtools sync push");
    expect(pullHelp.stdout).toContain("$ devtools sync pull");
  });

  it("prints the sync directory in non-interactive mode", async () => {
    const workspace = await createWorkspace();
    const xdgConfigHome = join(workspace, "xdg");
    const result = await runCli(["sync", "cd"], {
      env: {
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    });

    expect(result.stdout).toBe(`${join(xdgConfigHome, "devtools", "sync")}`);
  });

  it("adds and forgets tracked sync targets from the CLI", async () => {
    const workspace = await createWorkspace();
    const xdgConfigHome = join(workspace, "xdg");
    const settingsDirectory = join(xdgConfigHome, "mytool");
    const settingsFile = join(settingsDirectory, "settings.json");
    const secretsDirectory = join(settingsDirectory, "secrets");
    const syncDirectory = join(xdgConfigHome, "devtools", "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(secretsDirectory, { recursive: true });
    await writeFile(settingsFile, "{}\n");
    await writeFile(join(secretsDirectory, "token.txt"), "secret\n");

    await runCli(
      [
        "sync",
        "init",
        "--recipient",
        ageKeys.recipient,
        "--identity",
        "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      ],
      {
        env: {
          XDG_CONFIG_HOME: xdgConfigHome,
        },
      },
    );

    const addFileResult = await runCli(["sync", "add", settingsFile], {
      env: {
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    });
    const addDirectoryResult = await runCli(
      ["sync", "add", secretsDirectory, "--secret"],
      {
        env: {
          XDG_CONFIG_HOME: xdgConfigHome,
        },
      },
    );
    const configAfterAdd = JSON.parse(
      await readFile(join(syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: Array<{
        kind: string;
        localPath: string;
        name: string;
        repoPath: string;
      }>;
      secretGlobs: string[];
    };

    expect(addFileResult.stdout).toContain("Added sync target.");
    expect(addDirectoryResult.stdout).toContain("Secret glob: added");
    expect(configAfterAdd.entries).toEqual([
      {
        kind: "directory",
        localPath: "$XDG_CONFIG_HOME/mytool/secrets",
        name: "mytool/secrets",
        repoPath: "mytool/secrets",
      },
      {
        kind: "file",
        localPath: "$XDG_CONFIG_HOME/mytool/settings.json",
        name: "mytool/settings.json",
        repoPath: "mytool/settings.json",
      },
    ]);
    expect(configAfterAdd.secretGlobs).toEqual(["mytool/secrets/**"]);

    await mkdir(join(syncDirectory, "plain", "mytool", "secrets"), {
      recursive: true,
    });
    await mkdir(join(syncDirectory, "secret", "mytool", "secrets"), {
      recursive: true,
    });
    await writeFile(
      join(syncDirectory, "plain", "mytool", "secrets", "token.txt"),
      "stale plain copy\n",
    );
    await writeFile(
      join(syncDirectory, "secret", "mytool", "secrets", "token.txt.age"),
      "stale encrypted copy\n",
    );

    const forgetResult = await runCli(["sync", "forget", "mytool/secrets"], {
      env: {
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    });
    const configAfterForget = JSON.parse(
      await readFile(join(syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: Array<{
        repoPath: string;
      }>;
      secretGlobs: string[];
    };

    expect(forgetResult.stdout).toContain("Forgot sync target.");
    expect(configAfterForget.entries).toMatchObject([
      {
        repoPath: "mytool/settings.json",
      },
    ]);
    expect(configAfterForget.secretGlobs).toEqual([]);
    await expect(
      readFile(join(syncDirectory, "plain", "mytool", "secrets", "token.txt")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(syncDirectory, "secret", "mytool", "secrets", "token.txt.age"),
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("round-trips an encrypted sync repo across two machines with manual git", async () => {
    const workspace = await createWorkspace();
    const remoteRepository = join(workspace, "remote.git");
    const machineAXdg = join(workspace, "machine-a-xdg");
    const machineBXdg = join(workspace, "machine-b-xdg");
    const machineABundle = join(machineAXdg, "devtools", "local", "bundle");
    const machineBBundle = join(machineBXdg, "devtools", "local", "bundle");
    const ageKeys = await createAgeKeyPair();
    const identityExpression = "$XDG_CONFIG_HOME/devtools/age/keys.txt";

    await runGit(["init", "--bare", remoteRepository]);
    await writeIdentityFile(machineAXdg, ageKeys.identity);
    await writeIdentityFile(machineBXdg, ageKeys.identity);

    const initAResult = await runCli(
      [
        "sync",
        "init",
        remoteRepository,
        "--recipient",
        ageKeys.recipient,
        "--identity",
        identityExpression,
      ],
      {
        env: {
          XDG_CONFIG_HOME: machineAXdg,
        },
      },
    );
    const syncDirectoryA = join(machineAXdg, "devtools", "sync");

    expect(initAResult.stdout).toContain("Initialized sync directory.");

    await writeJsonFile(join(syncDirectoryA, "config.json"), {
      version: 1,
      age: {
        identityFile: identityExpression,
        recipients: [ageKeys.recipient],
      },
      entries: [
        {
          name: "bundle",
          kind: "directory",
          localPath: "$XDG_CONFIG_HOME/devtools/local/bundle",
          repoPath: "bundle",
        },
      ],
      secretGlobs: ["bundle/secret.json"],
    });

    await mkdir(machineABundle, { recursive: true });
    await writeFile(join(machineABundle, "plain.txt"), "plain value\n");
    await writeFile(
      join(machineABundle, "secret.json"),
      JSON.stringify({ token: "machine-a-secret" }, null, 2),
    );

    const pushResult = await runCli(["sync", "push"], {
      env: {
        XDG_CONFIG_HOME: machineAXdg,
      },
    });

    expect(pushResult.stdout).toContain("Synchronized local config");
    expect(
      await readFile(
        join(syncDirectoryA, "secret", "bundle", "secret.json.age"),
        "utf8",
      ),
    ).not.toContain("machine-a-secret");

    await runGit(["-C", syncDirectoryA, "checkout", "-B", "main"]);
    await runGit([
      "-C",
      syncDirectoryA,
      "config",
      "user.email",
      "tests@example.com",
    ]);
    await runGit([
      "-C",
      syncDirectoryA,
      "config",
      "user.name",
      "Devtools Tests",
    ]);
    await runGit(["-C", syncDirectoryA, "add", "."]);
    await runGit(["-C", syncDirectoryA, "commit", "-m", "sync snapshot"]);
    await runGit(["-C", syncDirectoryA, "push", "origin", "main"]);
    await runGit([
      "--git-dir",
      remoteRepository,
      "symbolic-ref",
      "HEAD",
      "refs/heads/main",
    ]);

    const initBResult = await runCli(["sync", "init", remoteRepository], {
      env: {
        XDG_CONFIG_HOME: machineBXdg,
      },
    });

    expect(initBResult.stdout).toContain("Sync directory already initialized.");

    const pullResult = await runCli(["sync", "pull"], {
      env: {
        XDG_CONFIG_HOME: machineBXdg,
      },
    });

    expect(pullResult.stdout).toContain(
      "Applied sync repository to local config.",
    );
    expect(await readFile(join(machineBBundle, "plain.txt"), "utf8")).toBe(
      "plain value\n",
    );
    expect(
      await readFile(join(machineBBundle, "secret.json"), "utf8"),
    ).toContain("machine-a-secret");
  });
});
