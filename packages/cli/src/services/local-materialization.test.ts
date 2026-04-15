import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsolaInstance } from "consola";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
  SyncConfigEntryKind,
  SyncMode,
} from "#app/config/sync.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import {
  collectChangedLocalPaths,
  countDeletedLocalNodes,
} from "#app/services/local-materialization.ts";
import { createTemporaryDirectory } from "../test/helpers/sync-fixture.ts";

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
  const reporter = {
    level: 4,
    start: () => {},
    verbose: (message: string) => {
      messages.push(message);
    },
  } as unknown as ConsolaInstance;

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

  it("records deleted local paths while planning pull", async () => {
    const workspace = await createWorkspace();
    const appDirectory = join(workspace, ".config", "app");
    const configFile = join(appDirectory, "config.json");
    const cacheFile = join(appDirectory, "cache.json");

    await mkdir(appDirectory, { recursive: true });
    await writeFile(configFile, "{}\n", "utf8");
    await writeFile(cacheFile, "{}\n", "utf8");

    const existingKeys = new Set<string>();
    const keyToLocalPath = new Map<string, string>();
    const entry = createEntry(
      "directory",
      appDirectory,
      ".config/app",
      "normal",
    );

    const deletedLocalCount = await countDeletedLocalNodes(
      entry,
      new Set([buildDirectoryKey(".config/app"), ".config/app/config.json"]),
      createConfig([entry]),
      existingKeys,
      undefined,
      keyToLocalPath,
    );

    expect(deletedLocalCount).toBe(1);
    expect(keyToLocalPath.get(".config/app/cache.json")).toBe(cacheFile);
  });

  it("collects only changed local paths for a materialized directory", async () => {
    const workspace = await createWorkspace();
    const appDirectory = join(workspace, ".config", "app");
    const configFile = join(appDirectory, "config.json");
    const linkPath = join(appDirectory, "current");

    await mkdir(appDirectory, { recursive: true });
    await writeFile(configFile, '{"version":1}\n', "utf8");
    await writeFile(join(appDirectory, "v1"), "", "utf8");
    await symlink("./v1", linkPath, "file");

    const entry = createEntry(
      "directory",
      appDirectory,
      ".config/app",
      "normal",
    );

    await writeFile(join(appDirectory, "stale.txt"), "old\n", "utf8");

    expect(
      await collectChangedLocalPaths(entry, {
        desiredKeys: new Set([
          buildDirectoryKey(".config/app"),
          ".config/app/config.json",
          ".config/app/current",
          ".config/app/missing.txt",
        ]),
        nodes: new Map([
          [
            "config.json",
            {
              contents: Buffer.from('{"version":1}\n'),
              executable: false,
              secret: false,
              type: "file",
            },
          ],
          [
            "current",
            {
              linkTarget: "./v1",
              type: "symlink",
            },
          ],
          [
            "missing.txt",
            {
              contents: Buffer.from("new\n"),
              executable: false,
              secret: false,
              type: "file",
            },
          ],
        ]),
        type: "directory",
      }),
    ).toEqual([join(appDirectory, "missing.txt")]);
  });

  it("includes stale local paths for incremental directory updates", async () => {
    const workspace = await createWorkspace();
    const appDirectory = join(workspace, ".config", "app");
    const configFile = join(appDirectory, "config.json");
    const staleFile = join(appDirectory, "stale.txt");

    await mkdir(appDirectory, { recursive: true });
    await writeFile(configFile, '{"version":1}\n', "utf8");
    await writeFile(staleFile, "old\n", "utf8");

    const entry = createEntry(
      "directory",
      appDirectory,
      ".config/app",
      "normal",
    );

    expect(
      await collectChangedLocalPaths(
        entry,
        {
          desiredKeys: new Set([
            buildDirectoryKey(".config/app"),
            ".config/app/config.json",
          ]),
          nodes: new Map([
            [
              "config.json",
              {
                contents: Buffer.from('{"version":1}\n'),
                executable: false,
                secret: false,
                type: "file",
              },
            ],
          ]),
          type: "directory",
        },
        createConfig([entry]),
      ),
    ).toEqual([staleFile]);
  });

  it("does not count explicit child entry paths as stale parent paths", async () => {
    const workspace = await createWorkspace();
    const rootDirectory = join(workspace, ".config", "zsh");
    const childDirectory = join(rootDirectory, "plugins");
    const parentFile = join(rootDirectory, ".zshrc");
    const childFile = join(childDirectory, "plugin.zsh");

    await mkdir(childDirectory, { recursive: true });
    await writeFile(parentFile, "source ~/.zsh/plugins/plugin.zsh\n", "utf8");
    await writeFile(childFile, "echo plugin\n", "utf8");

    const rootEntry = createEntry(
      "directory",
      rootDirectory,
      ".config/zsh",
      "normal",
    );
    const childEntry = createEntry(
      "directory",
      childDirectory,
      ".config/zsh/plugins",
      "normal",
    );
    const existingKeys = new Set<string>();
    const keyToLocalPath = new Map<string, string>();

    const deletedLocalCount = await countDeletedLocalNodes(
      rootEntry,
      new Set([buildDirectoryKey(".config/zsh"), ".config/zsh/.zshrc"]),
      createConfig([rootEntry, childEntry]),
      existingKeys,
      undefined,
      keyToLocalPath,
    );

    expect(deletedLocalCount).toBe(0);
    expect(existingKeys).toEqual(
      new Set([buildDirectoryKey(".config/zsh"), ".config/zsh/.zshrc"]),
    );
    expect(keyToLocalPath.has(".config/zsh/plugins/plugin.zsh")).toBe(false);
  });
});
