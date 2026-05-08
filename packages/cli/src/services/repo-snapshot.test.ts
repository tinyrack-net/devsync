import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSTANTS } from "#app/config/constants.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import type { EffectiveSyncConfig } from "./runtime.ts";

const mocked = vi.hoisted(() => ({
  getPathStats: vi.fn(),
  listDirectoryEntries: vi.fn(),
  lstat: vi.fn(),
  readFile: vi.fn(),
  readlink: vi.fn(),
  decryptSecretFile: vi.fn(),
  findOwningSyncEntry: vi.fn(),
  isExecutableMode: vi.fn((mode: number | bigint) => {
    return (Number(mode) & 0o111) !== 0;
  }),
  resolveSyncRule: vi.fn(),
  collectArtifactProfiles: vi.fn(() => new Set(["work"])),
  parseArtifactRelativePath: vi.fn((p) => {
    const segments = p.split("/");
    return {
      profile: segments[0],
      repoPath: segments.slice(1).join("/"),
      secret: p.endsWith(".age"),
    };
  }),
  assertStorageSafeRepoPath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  lstat: mocked.lstat,
  readFile: mocked.readFile,
  readlink: mocked.readlink,
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  getPathStats: mocked.getPathStats,
  listDirectoryEntries: mocked.listDirectoryEntries,
}));

vi.mock("#app/config/sync-entry.ts", () => ({
  findOwningSyncEntry: mocked.findOwningSyncEntry,
  resolveSyncRule: mocked.resolveSyncRule,
  resolveManagedSyncMode: vi.fn(() => "normal"),
}));

vi.mock("./repo-artifacts.ts", () => ({
  collectArtifactProfiles: mocked.collectArtifactProfiles,
  parseArtifactRelativePath: mocked.parseArtifactRelativePath,
  assertStorageSafeRepoPath: mocked.assertStorageSafeRepoPath,
}));

vi.mock("#app/lib/file-mode.ts", () => ({
  isExecutableMode: mocked.isExecutableMode,
}));

describe("repo-snapshot service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.isExecutableMode.mockImplementation((mode: number | bigint) => {
      return (Number(mode) & 0o111) !== 0;
    });
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

  it("derives executable metadata from explicit manifest permission", async () => {
    const entry = {
      kind: "file",
      repoPath: "config.json",
      localPath: "/home/user/config.json",
      profiles: ["work"],
      mode: "normal",
      profilesExplicit: true,
      modeExplicit: true,
      permission: 0o600,
      permissionExplicit: true,
      configuredMode: { default: "normal" },
      configuredLocalPath: { default: "~/config.json" },
      configuredPermission: { default: "0600" },
    } as const;
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [entry],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "config.json" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o755,
    });
    mocked.readFile.mockResolvedValue(Buffer.from("data"));
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });
    mocked.findOwningSyncEntry.mockReturnValue(entry);

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("config.json")).toMatchObject({
      executable: false,
      type: "file",
    });
    expect(mocked.isExecutableMode).toHaveBeenCalledWith(0o600);
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
    mocked.listDirectoryEntries.mockResolvedValueOnce([]); // No files found in work/ profile
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("dotconfig")?.type).toBe("directory");
  });
});
