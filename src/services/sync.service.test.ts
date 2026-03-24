import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.js";
import { trackSyncTarget } from "./add.js";
import { initializeSync } from "./init.js";
import {
  assignSyncProfiles,
  clearSyncProfiles,
  listSyncProfiles,
  useSyncProfile,
} from "./profile.js";
import { pullSync } from "./pull.js";
import { pushSync } from "./push.js";
import { setSyncTargetMode } from "./set.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-sync-test-");

  temporaryDirectories.push(directory);

  return directory;
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

describe("sync service", () => {
  it("tracks entries in v6 manifest format", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sharedDirectory = join(homeDirectory, ".config", "zsh");
    const workFile = join(homeDirectory, ".gitconfig-work");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sharedDirectory, { recursive: true });
    await writeFile(
      join(sharedDirectory, "secrets.zsh"),
      "export TOKEN=work\n",
    );
    await writeFile(workFile, "[include]\npath=~/.gitconfig.work\n");

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    await trackSyncTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      environment,
      cwd,
    );
    await trackSyncTarget(
      {
        mode: "secret",
        target: workFile,
      },
      environment,
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as {
      entries: Array<Record<string, unknown>>;
      version: number;
    };

    expect(config.version).toBe(6);
    expect(config).toHaveProperty("age");
    expect(config.entries).toEqual([
      {
        kind: "directory",
        localPath: { default: "~/.config/zsh" },
        mode: "normal",
      },
      {
        kind: "file",
        localPath: { default: "~/.gitconfig-work" },
        mode: "secret",
      },
    ]);
  });

  it("manages the active profile through the global config", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sharedDirectory = join(homeDirectory, ".config", "zsh");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sharedDirectory, { recursive: true });
    await writeFile(
      join(sharedDirectory, "secrets.zsh"),
      "export TOKEN=work\n",
    );

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await trackSyncTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      environment,
      cwd,
    );
    await setSyncTargetMode(
      {
        mode: "secret",
        target: join(sharedDirectory, "secrets.zsh"),
      },
      environment,
      cwd,
    );

    expect(await useSyncProfile("work", environment)).toMatchObject({
      action: "use",
      activeProfile: "work",
      profile: "work",
    });
    expect(await clearSyncProfiles(environment)).toMatchObject({
      action: "clear",
    });
  });

  it("pushes and pulls with the active profile", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const sharedFile = join(zshDirectory, "zshrc");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(sharedFile, "export PATH=$PATH:$HOME/bin\n");
    await writeFile(secretsFile, "export TOKEN=work\n");

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await trackSyncTarget(
      {
        mode: "normal",
        target: zshDirectory,
      },
      environment,
      cwd,
    );
    await setSyncTargetMode(
      {
        mode: "secret",
        target: secretsFile,
      },
      environment,
      cwd,
    );

    await pushSync(
      {
        dryRun: false,
      },
      environment,
    );

    const sharedArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "default",
      ".config",
      "zsh",
      "zshrc",
    );
    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "default",
      ".config",
      "zsh",
      "secrets.zsh.devsync.secret",
    );

    expect(await readFile(sharedArtifact, "utf8")).toContain("PATH");
    expect(await readFile(secretArtifact, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );

    await writeFile(secretsFile, "local-change\n");
    await pullSync(
      {
        dryRun: false,
      },
      environment,
    );

    expect(await readFile(secretsFile, "utf8")).toContain("TOKEN=work");

    await setSyncTargetMode(
      {
        mode: "normal",
        target: secretsFile,
      },
      environment,
      cwd,
    );

    const configAfterModeChange = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        localPath: { default: string };
        mode?: string;
      }>;
    };
    const secretEntry = configAfterModeChange.entries.find(
      (entry) => entry.localPath.default === "~/.config/zsh/secrets.zsh",
    );

    expect(secretEntry?.mode).toBe("normal");
  });

  it("assigns and unassigns profiles to entries", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await trackSyncTarget(
      { mode: "normal", target: gitconfig },
      environment,
      cwd,
    );

    const assignResult = await assignSyncProfiles(
      {
        target: gitconfig,
        profiles: ["default", "work"],
      },
      environment,
      cwd,
    );

    expect(assignResult.action).toBe("assigned");
    expect(assignResult.profiles).toEqual(["default", "work"]);

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ profiles?: string[] }> };

    expect(config.entries[0]?.profiles).toEqual(["default", "work"]);

    const listResult = await listSyncProfiles(environment);

    expect(listResult.availableProfiles).toEqual(["default", "work"]);
    expect(listResult.assignments).toEqual([
      {
        entryLocalPath: gitconfig,
        entryRepoPath: ".gitconfig",
        profiles: ["default", "work"],
      },
    ]);

    const reassignResult = await assignSyncProfiles(
      { target: gitconfig, profiles: ["default"] },
      environment,
      cwd,
    );

    expect(reassignResult.action).toBe("assigned");
    expect(reassignResult.profiles).toEqual(["default"]);

    const clearResult = await assignSyncProfiles(
      { target: gitconfig, profiles: [] },
      environment,
      cwd,
    );

    expect(clearResult.action).toBe("assigned");
    expect(clearResult.profiles).toEqual([]);

    const configAfter = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ profiles?: string[] }> };

    expect(configAfter.entries[0]?.profiles).toBeUndefined();
  });
});
