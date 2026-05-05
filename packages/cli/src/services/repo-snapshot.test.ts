import { beforeEach, describe, expect, it, mock } from "bun:test";
import { CONSTANTS } from "#app/config/constants.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import type { EffectiveSyncConfig } from "./runtime.ts";

type MockFn = ReturnType<typeof mock>;

mock.module("node:fs/promises", () => ({
  lstat: mock(),
  readFile: mock(),
  readlink: mock(),
}));

mock.module("#app/lib/filesystem.ts", () => ({
  getPathStats: mock(),
  listDirectoryEntries: mock(),
}));

mock.module("#app/config/sync.ts", () => ({
  resolveSyncRule: mock(),
  resolveManagedSyncMode: mock(() => "normal"),
}));

mock.module("./repo-artifacts.ts", () => ({
  collectArtifactProfiles: mock(() => new Set(["work"])),
  parseArtifactRelativePath: mock((p: string) => {
    const segments = p.split("/");
    return {
      profile: segments[0],
      repoPath: segments.slice(1).join("/"),
      secret: p.endsWith(".age"),
    };
  }),
  assertStorageSafeRepoPath: mock(),
}));

mock.module("#app/lib/file-mode.ts", () => ({
  isExecutableMode: mock(() => false),
}));

import * as mockedFs from "node:fs/promises";
import * as mockedSyncConfig from "#app/config/sync.ts";
import * as mockedFilesystem from "#app/lib/filesystem.ts";
import * as mockedRepoArtifacts from "./repo-artifacts.ts";

const mocked = {
  getPathStats: mockedFilesystem.getPathStats as MockFn,
  listDirectoryEntries: mockedFilesystem.listDirectoryEntries as MockFn,
  lstat: mockedFs.lstat as MockFn,
  readFile: mockedFs.readFile as MockFn,
  readlink: mockedFs.readlink as MockFn,
  resolveSyncRule: mockedSyncConfig.resolveSyncRule as MockFn,
  collectArtifactProfiles:
    mockedRepoArtifacts.collectArtifactProfiles as MockFn,
  parseArtifactRelativePath:
    mockedRepoArtifacts.parseArtifactRelativePath as MockFn,
  assertStorageSafeRepoPath:
    mockedRepoArtifacts.assertStorageSafeRepoPath as MockFn,
};

describe("repo-snapshot service", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("scans repository and builds snapshot", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          repoPath: "config.json",
          localPath: "/home/user/config.json",
          profiles: ["work"],
          mode: "normal",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/config.json" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "config.json" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o644,
    });
    mocked.readFile.mockResolvedValue(Buffer.from("data"));
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.size).toBe(1);
    expect(snapshot.get("config.json")).toBeDefined();
    expect(snapshot.get("config.json")?.type).toBe("file");
  });

  it("handles directory entries", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "directory",
          repoPath: "dotconfig",
          localPath: "/home/user/.config",
          profiles: ["work"],
          mode: "normal",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/.config" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValueOnce([]);
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("dotconfig")?.type).toBe("directory");
  });
});
