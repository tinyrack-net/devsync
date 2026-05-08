import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  HOME: "",
  XDG_CONFIG_HOME: "",
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

import { AppConstants } from "#app/config/constants.ts";
import { initializeSyncDirectory } from "#app/services/init.ts";
import { pullChanges } from "#app/services/pull.ts";
import { pushChanges } from "#app/services/push.ts";
import { getStatus } from "#app/services/status.ts";
import { setTargetMode } from "#app/services/sync-mode.ts";
import { trackTarget } from "#app/services/track.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-dry-run-");

  temporaryDirectories.push(directory);

  return directory;
};

const setEnvironment = (homeDirectory: string, xdgConfigHome: string) => {
  mockEnv.HOME = homeDirectory;
  mockEnv.XDG_CONFIG_HOME = xdgConfigHome;
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
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");
    await writeFile(secretFile, "secret\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);
    await initializeSyncDirectory({
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: bundleDirectory,
      },
      cwd,
    );
    await setTargetMode(
      {
        mode: "secret",
        target: secretFile,
      },
      cwd,
    );

    const result = await pushChanges({
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.directoryCount).toBe(1);
    expect(result.plainFileCount).toBe(1);
    expect(result.encryptedFileCount).toBe(1);
    await expect(
      readFile(
        join(
          xdgConfigHome,
          "dotweave",
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
          "dotweave",
          "sync",
          "default",
          "bundle",
          `token.txt${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`,
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
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);
    await initializeSyncDirectory({
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: bundleDirectory,
      },
      cwd,
    );
    await pushChanges({
      dryRun: false,
    });

    await writeFile(plainFile, "changed locally\n", "utf8");
    await writeFile(extraFile, "leave me\n", "utf8");

    const result = await pullChanges({
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.plainFileCount).toBe(1);
    expect(result.deletedLocalCount).toBeGreaterThanOrEqual(1);
    expect(await readFile(plainFile, "utf8")).toBe("changed locally\n");
    expect(await readFile(extraFile, "utf8")).toBe("leave me\n");
  });

  it("reports status planning progress", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const plainFile = join(bundleDirectory, "plain.txt");
    const ageKeys = await createAgeKeyPair();
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);
    await initializeSyncDirectory({
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: bundleDirectory,
      },
      cwd,
    );
    const result = await getStatus();

    expect(result.entryCount).toBe(1);
  });
});
