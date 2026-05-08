import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ResolvedSyncConfigEntry,
  SyncConfigEntryKind,
  SyncMode,
} from "#app/config/sync-schema.ts";
import { formatPermissionOctal } from "#app/lib/file-mode.ts";
import { buildLocalSnapshot } from "#app/services/local-snapshot.ts";
import type { EffectiveSyncConfig } from "#app/services/runtime.ts";
import { createTemporaryDirectory } from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-local-snapshot-");

  temporaryDirectories.push(directory);

  return directory;
};

const createEntry = (
  kind: SyncConfigEntryKind,
  localPath: string,
  repoPath: string,
  mode: SyncMode,
  permission?: number,
): ResolvedSyncConfigEntry => {
  return {
    configuredLocalPath: { default: localPath },
    configuredMode: { default: mode },
    ...(permission === undefined
      ? {}
      : {
          configuredPermission: { default: formatPermissionOctal(permission) },
        }),
    kind,
    localPath,
    mode,
    modeExplicit: true,
    ...(permission === undefined ? {} : { permission }),
    permissionExplicit: permission !== undefined,
    profiles: [],
    profilesExplicit: false,
    repoPath,
  };
};

const createConfig = (
  entries: readonly ResolvedSyncConfigEntry[],
): EffectiveSyncConfig => {
  return {
    age: {
      identityFile: "/tmp/keys.txt",
      recipients: [],
    },
    entries,
    version: 7,
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
    const snapshot = await buildLocalSnapshot(config);

    expect([...snapshot.keys()].sort()).toEqual([
      ".config/opencode",
      ".config/opencode/settings.json",
    ]);
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

  it.skipIf(process.platform === "win32")(
    "derives executable metadata from explicit manifest permission",
    async () => {
      const workspace = await createWorkspace();
      const keyFile = join(workspace, ".ssh", "id_rsa");

      await mkdir(join(workspace, ".ssh"), { recursive: true });
      await writeFile(keyFile, "key\n", "utf8");
      await chmod(keyFile, 0o755);

      const snapshot = await buildLocalSnapshot(
        createConfig([
          createEntry("file", keyFile, ".ssh/id_rsa", "normal", 0o600),
        ]),
      );
      const node = snapshot.get(".ssh/id_rsa");

      expect(node).toMatchObject({
        executable: false,
        type: "file",
      });
    },
  );
});
