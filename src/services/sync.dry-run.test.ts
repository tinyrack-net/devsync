import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncSecretArtifactSuffix } from "#app/config/sync.js";
import { trackSyncTarget } from "#app/services/add.js";
import { initializeSync } from "#app/services/init.js";
import { pullSync } from "#app/services/pull.js";
import { pushSync } from "#app/services/push.js";
import { setSyncTargetMode } from "#app/services/set.js";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-dry-run-");

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

describe("sync dry runs", () => {
  it("reports push changes without mutating repository artifacts", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const plainFile = join(bundleDirectory, "plain.txt");
    const secretFile = join(bundleDirectory, "token.txt");
    const ageKeys = await createAgeKeyPair();
    const environment = createEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");
    await writeFile(secretFile, "secret\n", "utf8");

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
        target: bundleDirectory,
      },
      environment,
      cwd,
    );
    await setSyncTargetMode(
      {
        state: "secret",
        target: secretFile,
      },
      environment,
      cwd,
    );

    const result = await pushSync(
      {
        dryRun: true,
      },
      environment,
    );

    expect(result.dryRun).toBe(true);
    expect(result.directoryCount).toBe(1);
    expect(result.plainFileCount).toBe(1);
    expect(result.encryptedFileCount).toBe(1);
    await expect(
      readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "default",
          "bundle",
          "plain.txt",
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "default",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports pull changes without mutating local files", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const plainFile = join(bundleDirectory, "plain.txt");
    const extraFile = join(bundleDirectory, "extra.txt");
    const ageKeys = await createAgeKeyPair();
    const environment = createEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");

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
        target: bundleDirectory,
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

    await writeFile(plainFile, "changed locally\n", "utf8");
    await writeFile(extraFile, "leave me\n", "utf8");

    const result = await pullSync(
      {
        dryRun: true,
      },
      environment,
    );

    expect(result.dryRun).toBe(true);
    expect(result.plainFileCount).toBe(1);
    expect(result.deletedLocalCount).toBeGreaterThanOrEqual(1);
    expect(await readFile(plainFile, "utf8")).toBe("changed locally\n");
    expect(await readFile(extraFile, "utf8")).toBe("leave me\n");
  });
});
