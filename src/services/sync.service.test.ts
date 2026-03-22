import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";
import { trackSyncTarget } from "./add.ts";
import { initializeSync } from "./init.ts";
import {
  assignSyncMachines,
  clearSyncMachines,
  listSyncMachines,
  useSyncMachine,
} from "./machine.ts";
import { pullSync } from "./pull.ts";
import { pushSync } from "./push.ts";
import { createSyncContext } from "./runtime.ts";
import { setSyncTargetMode } from "./set.ts";

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

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );

    await trackSyncTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      context,
    );
    await trackSyncTarget(
      {
        mode: "secret",
        target: workFile,
      },
      context,
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
        localPath: "~/.config/zsh",
      },
      {
        kind: "file",
        localPath: "~/.gitconfig-work",
        mode: "secret",
      },
    ]);
  });

  it("manages the active machine through the global config", async () => {
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

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await trackSyncTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        state: "secret",
        target: join(sharedDirectory, "secrets.zsh"),
      },
      context,
    );

    expect(await useSyncMachine("work", context)).toMatchObject({
      activeMachine: "work",
      machine: "work",
      mode: "use",
    });
    expect(await clearSyncMachines(context)).toMatchObject({
      mode: "clear",
    });
  });

  it("pushes and pulls with the active machine", async () => {
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

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await trackSyncTarget(
      {
        mode: "normal",
        target: zshDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        state: "secret",
        target: secretsFile,
      },
      context,
    );

    await pushSync(
      {
        dryRun: false,
      },
      context,
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
      context,
    );

    expect(await readFile(secretsFile, "utf8")).toContain("TOKEN=work");

    await setSyncTargetMode(
      {
        state: "normal",
        target: secretsFile,
      },
      context,
    );

    const configAfterModeChange = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ localPath: string; mode?: string }> };
    const secretEntry = configAfterModeChange.entries.find(
      (entry) => entry.localPath === "~/.config/zsh/secrets.zsh",
    );

    expect(secretEntry?.mode).toBeUndefined();
  });

  it("assigns and unassigns machines to entries", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await trackSyncTarget({ mode: "normal", target: gitconfig }, context);

    const assignResult = await assignSyncMachines(
      {
        target: gitconfig,
        machines: ["default", "work"],
      },
      context,
    );

    expect(assignResult.action).toBe("assigned");
    expect(assignResult.machines).toEqual(["default", "work"]);

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ machines?: string[] }> };

    expect(config.entries[0]?.machines).toEqual(["default", "work"]);

    const listResult = await listSyncMachines(context);

    expect(listResult.availableMachines).toEqual(["default", "work"]);
    expect(listResult.assignments).toEqual([
      {
        entryLocalPath: gitconfig,
        entryRepoPath: ".gitconfig",
        machines: ["default", "work"],
      },
    ]);

    const reassignResult = await assignSyncMachines(
      { target: gitconfig, machines: ["default"] },
      context,
    );

    expect(reassignResult.action).toBe("assigned");
    expect(reassignResult.machines).toEqual(["default"]);

    const clearResult = await assignSyncMachines(
      { target: gitconfig, machines: [] },
      context,
    );

    expect(clearResult.action).toBe("assigned");
    expect(clearResult.machines).toEqual([]);

    const configAfter = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ machines?: string[] }> };

    expect(configAfter.entries[0]?.machines).toBeUndefined();
  });
});
