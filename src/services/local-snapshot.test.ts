import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
  SyncConfigEntryKind,
  SyncMode,
} from "#app/config/sync.js";
import type { ProgressReporter } from "#app/lib/progress.js";
import { buildLocalSnapshot } from "#app/services/local-snapshot.js";
import { createTemporaryDirectory } from "../test/helpers/sync-fixture.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-local-snapshot-");

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

describe("local snapshot", () => {
  it("does not recurse into ignored directory entries", async () => {
    const workspace = await createWorkspace();
    const opencodeDirectory = join(workspace, ".config", "opencode");
    const nodeModulesDirectory = join(opencodeDirectory, "node_modules");
    const nestedDirectory = join(nodeModulesDirectory, "pkg-a", "dist");
    const trackedFile = join(opencodeDirectory, "settings.json");
    const ignoredFile = join(nestedDirectory, "index.js");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(trackedFile, "{\n}\n", "utf8");
    await writeFile(ignoredFile, "module.exports = {}\n", "utf8");

    const config = createConfig([
      createEntry("directory", opencodeDirectory, ".config/opencode", "normal"),
      createEntry(
        "directory",
        nodeModulesDirectory,
        ".config/opencode/node_modules",
        "ignore",
      ),
    ]);
    const { messages, reporter } = createProgressCapture();

    const snapshot = await buildLocalSnapshot(config, reporter);

    expect([...snapshot.keys()].sort()).toEqual([
      ".config/opencode",
      ".config/opencode/settings.json",
    ]);
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

  it("still captures explicit child overrides under ignored directories", async () => {
    const workspace = await createWorkspace();
    const opencodeDirectory = join(workspace, ".config", "opencode");
    const nodeModulesDirectory = join(opencodeDirectory, "node_modules");
    const nestedDirectory = join(nodeModulesDirectory, "pkg-a");
    const ignoredFile = join(nestedDirectory, "index.js");
    const keepFile = join(nodeModulesDirectory, "keep.js");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(ignoredFile, "module.exports = {}\n", "utf8");
    await writeFile(keepFile, "export const keep = true;\n", "utf8");

    const snapshot = await buildLocalSnapshot(
      createConfig([
        createEntry(
          "directory",
          opencodeDirectory,
          ".config/opencode",
          "normal",
        ),
        createEntry(
          "directory",
          nodeModulesDirectory,
          ".config/opencode/node_modules",
          "ignore",
        ),
        createEntry(
          "file",
          keepFile,
          ".config/opencode/node_modules/keep.js",
          "normal",
        ),
      ]),
    );

    expect(snapshot.has(".config/opencode")).toBe(true);
    expect(snapshot.has(".config/opencode/node_modules")).toBe(false);
    expect(snapshot.has(".config/opencode/node_modules/keep.js")).toBe(true);
    expect(snapshot.has(".config/opencode/node_modules/pkg-a/index.js")).toBe(
      false,
    );
  });
});
