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
import { listSyncConfig } from "./list.ts";
import {
  clearSyncMachines,
  listSyncMachines,
  useSyncMachine,
} from "./machine.ts";
import { pullSync } from "./pull.ts";
import { pushSync } from "./push.ts";
import { setSyncRule, unsetSyncRule } from "./rule.ts";
import { createSyncContext } from "./runtime.ts";

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
  it("tracks shared and machine-specific roots in v2 config", async () => {
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
    await writeFile(
      join(sharedDirectory, "secrets.zsh"),
      "export TOKEN=work\n",
    );
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
        machine: "work",
        mode: "secret",
        target: workFile,
      },
      context,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<Record<string, unknown>>;
      version: number;
    };

    expect(config.version).toBe(2);
    expect(config.entries).toEqual([
      {
        base: {
          mode: "normal",
        },
        kind: "directory",
        localPath: "~/.config/zsh",
        repoPath: ".config/zsh",
      },
      {
        kind: "file",
        localPath: "~/.gitconfig-work",
        machines: {
          work: {
            mode: "secret",
          },
        },
        repoPath: ".gitconfig-work",
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
    await setSyncRule(
      {
        machine: "work",
        recursive: false,
        state: "secret",
        target: join(sharedDirectory, "secrets.zsh"),
      },
      context,
    );

    expect((await listSyncMachines(context)).availableMachines).toEqual([
      "work",
    ]);
    expect(await useSyncMachine("work", context)).toMatchObject({
      activeMachine: "work",
      machine: "work",
      mode: "use",
    });
    expect(await clearSyncMachines(context)).toMatchObject({
      mode: "clear",
    });
  });

  it("pushes and pulls base plus the active machine layer", async () => {
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
    await setSyncRule(
      {
        recursive: false,
        state: "ignore",
        target: secretsFile,
      },
      context,
    );
    await setSyncRule(
      {
        machine: "work",
        recursive: false,
        state: "secret",
        target: secretsFile,
      },
      context,
    );
    await useSyncMachine("work", context);

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
      "base",
      ".config",
      "zsh",
      "zshrc",
    );
    const machineArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "machines",
      "work",
      ".config",
      "zsh",
      "secrets.zsh.devsync.secret",
    );

    expect(await readFile(sharedArtifact, "utf8")).toContain("PATH");
    expect(await readFile(machineArtifact, "utf8")).toContain(
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

    await unsetSyncRule(
      {
        machine: "work",
        recursive: false,
        target: secretsFile,
      },
      context,
    );

    const listResult = await listSyncConfig(context);

    expect(
      listResult.entries.find((entry) => {
        return entry.machine === "work" && entry.repoPath === ".config/zsh";
      }),
    ).toBeUndefined();
  });
});
