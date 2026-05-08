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
  resolveManagedSyncMode: vi.fn(() => "normal"),
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
  resolveManagedSyncMode: mocked.resolveManagedSyncMode,
}));

vi.mock("#app/lib/crypto.ts", () => ({
  decryptSecretFile: mocked.decryptSecretFile,
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
    mocked.listDirectoryEntries.mockResolvedValueOnce([]);
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("dotconfig")?.type).toBe("directory");
  });

  it("reads symlink entries from the repository", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          repoPath: "link",
          localPath: "/home/user/link",
          profiles: ["work"],
          mode: "normal",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/link" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "link" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => true,
      isFile: () => false,
      mode: 0o777,
    });
    mocked.readlink.mockResolvedValue("/target/path");
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });
    mocked.resolveManagedSyncMode.mockReturnValue("normal");

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("link")).toMatchObject({
      type: "symlink",
      linkTarget: "/target/path",
    });
  });

  it("reads encrypted secret file entries", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          repoPath: "secret.conf",
          localPath: "/home/user/secret.conf",
          profiles: ["work"],
          mode: "secret",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "secret" },
          configuredLocalPath: { default: "~/secret.conf" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([
      { name: "secret.conf.age" },
    ]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o600,
    });
    mocked.readFile.mockResolvedValue("encrypted content");
    mocked.decryptSecretFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "secret" });
    mocked.parseArtifactRelativePath.mockReturnValue({
      profile: "work",
      repoPath: "secret.conf",
      secret: true,
    });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("secret.conf")).toMatchObject({
      type: "file",
      secret: true,
      contents: new Uint8Array([1, 2, 3]),
    });
  });

  it("skips entries when resolveSyncRule returns undefined (profile mismatch)", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          repoPath: "personal.conf",
          localPath: "/home/user/personal.conf",
          profiles: ["personal"],
          mode: "normal",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/personal.conf" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "personal.conf" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o644,
    });
    mocked.readFile.mockResolvedValue(Buffer.from("data"));
    mocked.resolveSyncRule.mockReturnValue(undefined);

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.has("personal.conf")).toBe(false);
  });

  it("handles multiple profile directories in the repository", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          repoPath: "work.conf",
          localPath: "/home/user/work.conf",
          profiles: ["work"],
          mode: "normal",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/work.conf" },
        },
        {
          kind: "file",
          repoPath: "common.conf",
          localPath: "/home/user/common.conf",
          profiles: [],
          mode: "normal",
          profilesExplicit: false,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/common.conf" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.collectArtifactProfiles.mockReturnValue(
      new Set(["work", "default"]),
    );
    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockImplementation((dir: string) => {
      if (dir.endsWith("/work"))
        return Promise.resolve([{ name: "work.conf" }]);
      if (dir.endsWith("/default"))
        return Promise.resolve([{ name: "common.conf" }]);
      return Promise.resolve([]);
    });
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o644,
    });
    mocked.readFile.mockResolvedValue(Buffer.from("data"));
    mocked.resolveSyncRule.mockImplementation(
      (_config: unknown, repoPath: string) => {
        if (repoPath === "work.conf")
          return { profile: "work", mode: "normal" };
        if (repoPath === "common.conf")
          return { profile: "default", mode: "normal" };
        return undefined;
      },
    );
    mocked.parseArtifactRelativePath.mockImplementation((p: string) => {
      const segments = p.split("/");
      return {
        profile: segments[0],
        repoPath: segments.slice(1).join("/"),
        secret: p.endsWith(".age"),
      };
    });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("work.conf")).toBeDefined();
    expect(snapshot.get("common.conf")).toBeDefined();
  });

  it("derives executable metadata from file mode when permission is not explicit", async () => {
    const entry = {
      kind: "file",
      repoPath: "script.sh",
      localPath: "/home/user/script.sh",
      profiles: ["work"],
      mode: "normal",
      profilesExplicit: true,
      modeExplicit: true,
      permissionExplicit: false,
      configuredMode: { default: "normal" },
      configuredLocalPath: { default: "~/script.sh" },
    } as const;
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [entry],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "script.sh" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o755,
    });
    mocked.readFile.mockResolvedValue(Buffer.from("#!/bin/sh"));
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });
    mocked.findOwningSyncEntry.mockReturnValue(entry);

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.get("script.sh")).toMatchObject({
      type: "file",
      executable: true,
    });
    expect(mocked.isExecutableMode).toHaveBeenCalledWith(0o755);
  });

  it("handles empty repository directory gracefully", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([]);
    mocked.collectArtifactProfiles.mockReturnValue(new Set(["work"]));

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config);

    expect(snapshot.size).toBe(0);
  });

  it("detects SECRET_STORED_PLAIN for a file marked secret but stored as plain", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          repoPath: "secret.conf",
          localPath: "/home/user/secret.conf",
          profiles: ["work"],
          mode: "secret",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "secret" },
          configuredLocalPath: { default: "~/secret.conf" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "secret.conf" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o644,
    });
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "secret" });
    mocked.resolveManagedSyncMode.mockReturnValue("secret");
    mocked.parseArtifactRelativePath.mockReturnValue({
      profile: "work",
      repoPath: "secret.conf",
      secret: false,
    });

    await expect(
      buildRepositorySnapshot("/tmp/repo", config),
    ).rejects.toThrow();
  });
});
