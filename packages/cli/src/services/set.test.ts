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
  buildSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  ensureGitRepository: vi.fn(),
  expandHomePath: vi.fn(),
  findOwningSyncEntry: vi.fn(),
  getPathStats: vi.fn(),
  isExplicitLocalPath: vi.fn(),
  normalizeSyncRepoPath: vi.fn((value: string) => value),
  readSyncConfig: vi.fn(),
  resolveEntryRelativeRepoPath: vi.fn(),
  resolveSyncConfigResolutionContext: vi.fn(() => ({
    homeDirectory: "/tmp/home",
    platformKey: "linux",
    readEnv: (_name: string) => undefined as string | undefined,
    xdgConfigHome: "/tmp/home/.config",
  })),
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
  normalizeSyncRepoPath: mocked.normalizeSyncRepoPath,
  readSyncConfig: mocked.readSyncConfig,
  resolveEntryRelativeRepoPath: mocked.resolveEntryRelativeRepoPath,
}));

vi.mock("#app/lib/path.ts", () => ({
  isExplicitLocalPath: mocked.isExplicitLocalPath,
}));

vi.mock("#app/config/xdg.ts", () => ({
  expandHomePath: mocked.expandHomePath,
}));

vi.mock("./config-file.ts", () => ({
  buildSyncConfigDocument: mocked.buildSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  getPathStats: mocked.getPathStats,
}));

vi.mock("./paths.ts", () => ({
  buildConfiguredHomeLocalPath: mocked.buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot: mocked.buildRepoPathWithinRoot,
  tryBuildRepoPathWithinRoot: mocked.tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput: mocked.tryNormalizeRepoPathInput,
}));

vi.mock("#app/lib/git.ts", () => ({
  ensureGitRepository: mocked.ensureGitRepository,
}));

vi.mock("./runtime.ts", () => ({
  resolveSyncConfigResolutionContext: mocked.resolveSyncConfigResolutionContext,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import { resolveSetTarget, setTargetMode } from "./set.ts";

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
      resolveSetTarget("   ", createConfig([]), "/tmp/cwd", "/tmp/home"),
    ).rejects.toThrowError("Target path is required.");
  });

  it("rejects missing explicit local targets", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.expandHomePath.mockReturnValueOnce("/tmp/home/.ssh/id_ed25519");
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(".ssh/id_ed25519");
    mocked.getPathStats.mockResolvedValueOnce(undefined);

    await expect(
      resolveSetTarget(
        "/tmp/home/.ssh/id_ed25519",
        createConfig([]),
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError("Sync set target does not exist.");
  });

  it("resolves explicit child paths inside tracked directories", async () => {
    const entry = directoryEntry();

    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.expandHomePath.mockReturnValueOnce(
      "/tmp/home/.config/app/config.json",
    );
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(
      ".config/app/config.json",
    );
    mocked.getPathStats.mockResolvedValueOnce(fileStats);
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValue("config.json");

    await expect(
      resolveSetTarget(
        "/tmp/home/.config/app/config.json",
        createConfig([entry]),
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

  it("resolves explicit child paths inside tracked directories with explicit repo paths", async () => {
    const entry = directoryEntry({
      configuredRepoPath: { default: "profiles/shared/app" },
      repoPath: "profiles/shared/app",
    });

    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.expandHomePath.mockReturnValueOnce(
      "/tmp/home/.config/app/config.json",
    );
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(
      ".config/app/config.json",
    );
    mocked.getPathStats.mockResolvedValueOnce(fileStats);
    mocked.findOwningSyncEntry.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        "/tmp/home/.config/app/config.json",
        createConfig([entry]),
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).resolves.toEqual({
      entry,
      localPath: "/tmp/home/.config/app/config.json",
      relativePath: "config.json",
      repoPath: "profiles/shared/app/config.json",
      stats: fileStats,
    });
  });

  it("rejects explicit local targets outside tracked directories", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(true);
    mocked.expandHomePath.mockReturnValueOnce("/tmp/home/.config/other/file");
    mocked.buildRepoPathWithinRoot.mockReturnValueOnce(".config/other/file");
    mocked.getPathStats.mockResolvedValueOnce(fileStats);
    mocked.findOwningSyncEntry.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        "/tmp/home/.config/other/file",
        createConfig([directoryEntry()]),
        "/tmp/cwd",
        "/tmp/home",
      ),
    ).rejects.toThrowError(
      "Local set target is not inside a tracked directory entry.",
    );
  });

  it("rejects invalid repository-style targets", async () => {
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.expandHomePath.mockReturnValueOnce("../outside");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget("../outside", createConfig([]), "/tmp/cwd", "/tmp/home"),
    ).rejects.toThrowError(
      "Sync set target is not a valid local or repository path.",
    );
  });

  it("resolves exact repository entries without changing the local path", async () => {
    const entry = fileEntry();

    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.expandHomePath.mockReturnValueOnce(".gitconfig");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".gitconfig");
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce(undefined);
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    await expect(
      resolveSetTarget(
        ".gitconfig",
        createConfig([entry]),
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
    mocked.expandHomePath.mockReturnValueOnce(".config/app/nested/config.json");
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
    mocked.expandHomePath.mockReturnValueOnce(".config/other/file");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".config/other/file");
    mocked.findOwningSyncEntry.mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        ".config/other/file",
        createConfig([directoryEntry()]),
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

    mocked.ensureGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.expandHomePath.mockReturnValueOnce(".gitconfig");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".gitconfig");
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce(undefined);
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    await expect(
      setTargetMode({ mode: "secret", target: ".gitconfig" }, "/tmp/cwd"),
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

    mocked.ensureGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.expandHomePath.mockReturnValueOnce(".gitconfig");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(".gitconfig");
    mocked.resolveEntryRelativeRepoPath.mockReturnValueOnce(undefined);
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    const result = await setTargetMode(
      { mode: "secret", target: ".gitconfig" },
      "/tmp/cwd",
    );

    expect(result.action).toBe("updated");
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
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

    mocked.ensureGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.expandHomePath.mockReturnValueOnce(".config/app/private.txt");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(
      ".config/app/private.txt",
    );
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValue("private.txt");
    mocked.getPathStats.mockResolvedValueOnce(fileStats);

    const result = await setTargetMode(
      { mode: "secret", target: ".config/app/private.txt" },
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
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
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

    mocked.ensureGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.isExplicitLocalPath.mockReturnValueOnce(false);
    mocked.expandHomePath.mockReturnValueOnce(".config/app/notes.txt");
    mocked.tryBuildRepoPathWithinRoot.mockReturnValueOnce(undefined);
    mocked.tryNormalizeRepoPathInput.mockReturnValueOnce(
      ".config/app/notes.txt",
    );
    mocked.findOwningSyncEntry.mockReturnValueOnce(entry);
    mocked.resolveEntryRelativeRepoPath.mockReturnValue("notes.txt");
    mocked.getPathStats.mockResolvedValueOnce(directoryStats);

    await expect(
      setTargetMode(
        { mode: "normal", target: ".config/app/notes.txt" },
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
