import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
} from "#app/config/sync.ts";

const mocked = vi.hoisted(() => ({
  buildConfiguredHomeLocalPath: vi.fn((repoPath: string) => ({
    default: `~/${repoPath}`,
  })),
  buildRepoPathWithinRoot: vi.fn(),
  createSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  ensureSyncRepository: vi.fn(),
  findOwningSyncEntry: vi.fn(),
  getPathStats: vi.fn(),
  isExplicitLocalPath: vi.fn(),
  readSyncConfig: vi.fn(),
  resolveCommandTargetPath: vi.fn(),
  resolveEntryRelativeRepoPath: vi.fn(),
  resolveSyncPaths: vi.fn(() => ({
    configPath: "/tmp/devsync/manifest.json",
    homeDirectory: "/tmp/home",
    syncDirectory: "/tmp/devsync",
  })),
  tryBuildRepoPathWithinRoot: vi.fn(),
  tryNormalizeRepoPathInput: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
}));

vi.mock("#app/config/sync.ts", () => ({
  findOwningSyncEntry: mocked.findOwningSyncEntry,
  readSyncConfig: mocked.readSyncConfig,
  resolveEntryRelativeRepoPath: mocked.resolveEntryRelativeRepoPath,
}));

vi.mock("#app/lib/path.ts", () => ({
  isExplicitLocalPath: mocked.isExplicitLocalPath,
}));

vi.mock("./config-file.ts", () => ({
  createSyncConfigDocument: mocked.createSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("./filesystem.ts", () => ({
  getPathStats: mocked.getPathStats,
}));

vi.mock("./paths.ts", () => ({
  buildConfiguredHomeLocalPath: mocked.buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot: mocked.buildRepoPathWithinRoot,
  resolveCommandTargetPath: mocked.resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot: mocked.tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput: mocked.tryNormalizeRepoPathInput,
}));

vi.mock("./runtime.ts", () => ({
  ensureSyncRepository: mocked.ensureSyncRepository,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import { resolveSetTarget, setSyncTargetMode } from "./set.ts";

const createConfig = (
  entries: readonly ResolvedSyncConfigEntry[],
): ResolvedSyncConfig => ({
  entries: [...entries],
  version: 7,
});

const directoryEntry = (
  overrides: Partial<ResolvedSyncConfigEntry> = {},
): ResolvedSyncConfigEntry => ({
  configuredLocalPath: { default: "~/.config/app" },
  configuredMode: { default: "normal" },
  kind: "directory",
  localPath: "/tmp/home/.config/app",
  mode: "normal",
  modeExplicit: false,
  permissionExplicit: false,
  profiles: [],
  profilesExplicit: false,
  repoPath: ".config/app",
  ...overrides,
});

const fileEntry = (
  overrides: Partial<ResolvedSyncConfigEntry> = {},
): ResolvedSyncConfigEntry => ({
  configuredLocalPath: { default: "~/.gitconfig" },
  configuredMode: { default: "secret" },
  kind: "file",
  localPath: "/tmp/home/.gitconfig",
  mode: "secret",
  modeExplicit: true,
  permissionExplicit: false,
  profiles: [],
  profilesExplicit: false,
  repoPath: ".gitconfig",
  ...overrides,
});

const directoryStats = {
  isDirectory: () => true,
};

const fileStats = {
  isDirectory: () => false,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("sync set service", () => {
  it("rejects blank set targets", async () => {
    await expect(
      resolveSetTarget(
        "   ",
        createConfig([]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError("Target path is required.");
  });

  it("rejects missing explicit local targets", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/home/.ssh/id_ed25519",
    );
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(".ssh/id_ed25519");
    mocked.getPathStats.mockResolvedValueOnce(undefined);

    await expect(
      resolveSetTarget(
        "/tmp/home/.ssh/id_ed25519",
        createConfig([]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError("Sync set target does not exist.");
  });

  it("resolves explicit child paths inside tracked directories", async () => {
    const entry = directoryEntry();

    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/home/.config/app/config.json",
    );
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(
      ".config/app/config.json",
    );
    mocked.getPathStats.mockResolvedValueOnce(fileStats);
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce("config.json");

    await expect(
      resolveSetTarget(
        "/tmp/home/.config/app/config.json",
        createConfig([entry]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).resolves.toEqual({
      entry,
      localPath: "/tmp/home/.config/app/config.json",
      relativePath: "config.json",
      repoPath: ".config/app/config.json",
      stats: fileStats,
    });
  });

  it("rejects explicit local targets outside tracked directories", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/home/.config/other/file",
    );
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(".config/other/file");
    mocked.getPathStats.mockResolvedValueOnce(fileStats);
    mocked.findOwningSyncEntry.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        "/tmp/home/.config/other/file",
        createConfig([directoryEntry()]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError(
      "Local set target is not inside a tracked directory entry.",
    );
  });

  it("rejects invalid repository-style targets", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce("/tmp/cwd/../outside");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        "../outside",
        createConfig([]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError(
      "Sync set target is not a valid local or repository path.",
    );
  });

  it("resolves exact repository entries without changing the local path", async () => {
    const entry = fileEntry();

    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce("/tmp/cwd/.gitconfig");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".gitconfig");
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce(undefined);
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    await expect(
      resolveSetTarget(
        ".gitconfig",
        createConfig([entry]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).resolves.toEqual({
      entry,
      localPath: "/tmp/home/.gitconfig",
      relativePath: "",
      repoPath: ".gitconfig",
      stats: fileStats,
    });
  });

  it("resolves nested repository targets under tracked directories", async () => {
    const entry = directoryEntry();

    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/cwd/.config/app/nested/config.json",
    );
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(
      ".config/app/nested/config.json",
    );
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValue("nested/config.json");
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    await expect(
      resolveSetTarget(
        ".config/app/nested/config.json",
        createConfig([entry]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).resolves.toEqual({
      entry,
      localPath: "/tmp/home/.config/app/nested/config.json",
      relativePath: "nested/config.json",
      repoPath: ".config/app/nested/config.json",
      stats: fileStats,
    });
  });

  it("rejects repository targets that are not tracked", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/cwd/.config/other/file",
    );
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".config/other/file");
    mocked.findOwningSyncEntry.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        ".config/other/file",
        createConfig([directoryEntry()]),
        { HOME: "/tmp/home" },
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError(
      "Repository set target is not inside a tracked directory entry.",
    );
  });

  it("returns unchanged for exact entries that already use the requested mode", async () => {
    const entry = fileEntry();
    const config = createConfig([entry]);

    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce("/tmp/cwd/.gitconfig");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".gitconfig");
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce(undefined);
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    await expect(
      setSyncTargetMode(
        { mode: "secret", target: ".gitconfig" },
        { HOME: "/tmp/home" },
        "/tmp/cwd",
      ),
    ).resolves.toEqual({
      action: "unchanged",
      configPath: "/tmp/devsync/manifest.json",
      entryRepoPath: ".gitconfig",
      localPath: "/tmp/home/.gitconfig",
      mode: "secret",
      repoPath: ".gitconfig",
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });

  it("rewrites exact entries when platform-specific overrides should be cleared", async () => {
    const entry = fileEntry({
      configuredMode: { default: "secret", linux: "ignore" },
    });
    const config = createConfig([entry]);

    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce("/tmp/cwd/.gitconfig");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".gitconfig");
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce(undefined);
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    const result = await setSyncTargetMode(
      { mode: "secret", target: ".gitconfig" },
      { HOME: "/tmp/home" },
      "/tmp/cwd",
    );

    expect(result.action).toBe("updated");
    expect(mocked.createSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        {
          ...entry,
          configuredMode: { default: "secret" },
          mode: "secret",
        },
      ],
    });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalled();
  });

  it("adds a child override when a nested target needs a different mode", async () => {
    const entry = directoryEntry();
    const config = createConfig([entry]);

    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/cwd/.config/app/private.txt",
    );
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(
      ".config/app/private.txt",
    );
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValue("private.txt");
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    const result = await setSyncTargetMode(
      { mode: "secret", target: ".config/app/private.txt" },
      { HOME: "/tmp/home" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      action: "added",
      configPath: "/tmp/devsync/manifest.json",
      entryRepoPath: ".config/app",
      localPath: "/tmp/home/.config/app/private.txt",
      mode: "secret",
      repoPath: ".config/app/private.txt",
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.createSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        entry,
        {
          configuredLocalPath: { default: "~/.config/app/private.txt" },
          configuredMode: { default: "secret" },
          kind: "file",
          localPath: "/tmp/home/.config/app/private.txt",
          mode: "secret",
          modeExplicit: true,
          permissionExplicit: false,
          profiles: [],
          profilesExplicit: false,
          repoPath: ".config/app/private.txt",
        },
      ],
    });
  });

  it("keeps nested targets unchanged when they inherit the parent mode", async () => {
    const entry = directoryEntry();
    const config = createConfig([entry]);

    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.resolveCommandTargetPath.mockReturnValueOnce(
      "/tmp/cwd/.config/app/notes.txt",
    );
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(
      ".config/app/notes.txt",
    );
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValue("notes.txt");
    mocked.getPathStats.mockResolvedValueOnce(directoryStats);

    await expect(
      setSyncTargetMode(
        { mode: "normal", target: ".config/app/notes.txt" },
        { HOME: "/tmp/home" },
        "/tmp/cwd",
      ),
    ).resolves.toEqual({
      action: "unchanged",
      configPath: "/tmp/devsync/manifest.json",
      entryRepoPath: ".config/app",
      localPath: "/tmp/home/.config/app/notes.txt",
      mode: "normal",
      repoPath: ".config/app/notes.txt",
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });
});
