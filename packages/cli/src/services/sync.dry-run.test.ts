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

import { syncSecretArtifactSuffix } from "#app/config/sync.ts";
import type { ProgressReporter } from "#app/lib/progress.ts";
import { initializeSyncDirectory } from "#app/services/init.ts";
import { pullChanges } from "#app/services/pull.ts";
import { pushChanges } from "#app/services/push.ts";
import { setTargetMode } from "#app/services/set.ts";
import { getStatus } from "#app/services/status.ts";
import { trackTarget } from "#app/services/track.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-dry-run-");

  temporaryDirectories.push(directory);

  return directory;
};

const setEnvironment = (homeDirectory: string, xdgConfigHome: string) => {
  mockEnv.HOME = homeDirectory;
  mockEnv.XDG_CONFIG_HOME = xdgConfigHome;
};

const createProgressCapture = (verbose = false) => {
  const messages: string[] = [];
  const reporter: ProgressReporter = {
    detail: (message: string) => {
      if (verbose) {
        messages.push(`detail:${message}`);
      }
    },
    phase: (message: string) => {
      messages.push(message);
    },
    verbose,
  };

  return {
    messages,
    reporter,
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
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");
    await writeFile(secretFile, "secret\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);
    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
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
    const { messages, reporter } = createProgressCapture();

    const result = await pushChanges(
      {
        dryRun: true,
      },
      reporter,
    );

    expect(result.dryRun).toBe(true);
    expect(result.directoryCount).toBe(1);
    expect(result.plainFileCount).toBe(1);
    expect(result.encryptedFileCount).toBe(1);
    expect(messages[0]).toBe("Starting push...");
    expect(messages).toEqual(
      expect.arrayContaining([
        "Scanning local files...",
        "Preparing repository artifacts...",
        "Scanning existing repository artifacts...",
      ]),
    );
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
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);
    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
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
    const { messages, reporter } = createProgressCapture();

    const result = await pullChanges(
      {
        dryRun: true,
      },
      reporter,
    );

    expect(result.dryRun).toBe(true);
    expect(result.plainFileCount).toBe(1);
    expect(result.deletedLocalCount).toBeGreaterThanOrEqual(1);
    expect(messages[0]).toBe("Starting pull...");
    expect(messages).toEqual(
      expect.arrayContaining([
        "Scanning repository artifacts...",
        "Planning local materializations...",
        "Scanning existing local paths...",
      ]),
    );
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
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: bundleDirectory,
      },
      cwd,
    );
    const { messages, reporter } = createProgressCapture();

    const result = await getStatus({
      reporter,
    });

    expect(result.entryCount).toBe(1);
    expect(messages[0]).toBe("Analyzing sync status...");
    expect(messages).toEqual(
      expect.arrayContaining([
        "Building push plan...",
        "Building pull plan...",
      ]),
    );
  });
});
