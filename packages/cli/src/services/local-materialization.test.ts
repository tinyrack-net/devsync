import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
  SyncConfigEntryKind,
  SyncMode,
} from "#app/config/sync.js";
import { buildDirectoryKey } from "#app/lib/path.js";
import type { ProgressReporter } from "#app/lib/progress.js";
import { countDeletedLocalNodes } from "#app/services/local-materialization.js";
import { createTemporaryDirectory } from "../test/helpers/sync-fixture.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory(
    "devsync-local-materialization-",
  );

  temporaryDirectories.push(directory);

  return directory;
};

const createEntry = (
  kind: SyncConfigEntryKind,
  localPath: string,
  repoPath: string,
  mode: SyncMode,
): ResolvedSyncConfigEntry => {
  return {
    configuredLocalPath: { default: localPath },
    configuredMode: { default: mode },
    kind,
    localPath,
    mode,
    modeExplicit: true,
    permissionExplicit: false,
    profiles: [],
    profilesExplicit: false,
    repoPath,
  };
};

const createConfig = (
  entries: readonly ResolvedSyncConfigEntry[],
): ResolvedSyncConfig => {
  return {
    entries,
    version: 7,
  };
};

const createProgressCapture = () => {
  const messages: string[] = [];
  const reporter: ProgressReporter = {
    detail: (message: string) => {
      messages.push(message);
    },
    phase: () => {},
    verbose: true,
  };

  return { messages, reporter };
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("local materialization", () => {
  it("does not scan ignored child directory descendants while planning pull", async () => {
    const workspace = await createWorkspace();
    const opencodeDirectory = join(workspace, ".config", "opencode");
    const nodeModulesDirectory = join(opencodeDirectory, "node_modules");
    const nestedDirectory = join(nodeModulesDirectory, "pkg-a", "dist");
    const trackedFile = join(opencodeDirectory, "settings.json");
    const ignoredFile = join(nestedDirectory, "index.js");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(trackedFile, "{\n}\n", "utf8");
    await writeFile(ignoredFile, "module.exports = {}\n", "utf8");

    const rootEntry = createEntry(
      "directory",
      opencodeDirectory,
      ".config/opencode",
      "normal",
    );
    const config = createConfig([
      rootEntry,
      createEntry(
        "directory",
        nodeModulesDirectory,
        ".config/opencode/node_modules",
        "ignore",
      ),
    ]);
    const existingKeys = new Set<string>();
    const { messages, reporter } = createProgressCapture();

    const deletedLocalCount = await countDeletedLocalNodes(
      rootEntry,
      new Set([
        buildDirectoryKey(".config/opencode"),
        ".config/opencode/settings.json",
      ]),
      config,
      existingKeys,
      reporter,
    );

    expect(deletedLocalCount).toBe(0);
    expect(existingKeys).toEqual(
      new Set([
        buildDirectoryKey(".config/opencode"),
        ".config/opencode/settings.json",
      ]),
    );
    expect(
      messages.some((message) => {
        return message.includes(".config/opencode/node_modules/pkg-a");
      }),
    ).toBe(false);
    expect(
      messages.some((message) => {
        return message.includes(
          ".config/opencode/node_modules/pkg-a/dist/index.js",
        );
      }),
    ).toBe(false);
  });

  it("skips ignored directory entries entirely while planning pull", async () => {
    const workspace = await createWorkspace();
    const opencodeDirectory = join(workspace, ".config", "opencode");
    const nodeModulesDirectory = join(opencodeDirectory, "node_modules");
    const nestedDirectory = join(nodeModulesDirectory, "pkg-a", "dist");
    const ignoredFile = join(nestedDirectory, "index.js");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(ignoredFile, "module.exports = {}\n", "utf8");

    const ignoredEntry = createEntry(
      "directory",
      nodeModulesDirectory,
      ".config/opencode/node_modules",
      "ignore",
    );
    const existingKeys = new Set<string>();
    const { messages, reporter } = createProgressCapture();

    const deletedLocalCount = await countDeletedLocalNodes(
      ignoredEntry,
      new Set<string>(),
      createConfig([
        createEntry(
          "directory",
          opencodeDirectory,
          ".config/opencode",
          "normal",
        ),
        ignoredEntry,
      ]),
      existingKeys,
      reporter,
    );

    expect(deletedLocalCount).toBe(0);
    expect(existingKeys.size).toBe(0);
    expect(messages).toEqual([]);
  });
});
