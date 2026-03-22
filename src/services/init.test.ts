import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DevsyncError } from "#app/services/error.ts";
import { initializeSync } from "#app/services/init.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-init-");

  temporaryDirectories.push(directory);

  return directory;
};

const createEnvironment = (
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

describe("init service", () => {
  it("clones a configured repository source during initialization", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await runGit(["init", "-b", "main", sourceRepository], workspace);

    const result = await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
        repository: sourceRepository,
      },
      createSyncContext({
        environment: createEnvironment(homeDirectory, xdgConfigHome),
      }),
    );

    expect(result.gitAction).toBe("cloned");
    expect(result.gitSource).toBe(sourceRepository);
    expect(
      await readFile(join(result.syncDirectory, "manifest.json"), "utf8"),
    ).toContain('"version": 5');
    expect(
      await readFile(join(xdgConfigHome, "devsync", "settings.json"), "utf8"),
    ).toContain("$XDG_CONFIG_HOME/devsync/age/keys.txt");
  });

  it("rejects non-empty sync directories that are not git repositories", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(syncDirectory, { recursive: true });
    await writeFile(join(syncDirectory, "placeholder.txt"), "keep\n", "utf8");

    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [ageKeys.recipient],
        },
        createSyncContext({
          environment: createEnvironment(homeDirectory, xdgConfigHome),
        }),
      ),
    ).rejects.toThrowError(DevsyncError);
    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [ageKeys.recipient],
        },
        createSyncContext({
          environment: createEnvironment(homeDirectory, xdgConfigHome),
        }),
      ),
    ).rejects.toThrowError(/Sync directory already exists and is not empty/u);
    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [ageKeys.recipient],
        },
        createSyncContext({
          environment: createEnvironment(homeDirectory, xdgConfigHome),
        }),
      ),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([`Sync directory: ${syncDirectory}`]),
    });
  });

  it("rejects recipient mismatches against an existing config", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const context = createSyncContext({
      environment: createEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );

    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: ["age1differentrecipient"],
        },
        context,
      ),
    ).rejects.toThrowError(/different age recipients/u);
  });
});
