import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Stats } from "node:fs";
import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
} from "#app/config/sync.ts";

const nativePath = (value: string) =>
  process.platform === "win32" ? `C:${value.replaceAll("/", "\\")}` : value;

mock.module("#app/config/sync.ts", () => ({
  findOwningSyncEntry: mock(),
  normalizeSyncRepoPath: mock((value: string) => value),
  readSyncConfig: mock(),
  resolveEntryRelativeRepoPath: mock(),
}));

mock.module("#app/lib/path.ts", () => ({
  isExplicitLocalPath: mock(),
}));

mock.module("#app/config/xdg.ts", () => ({
  expandHomePath: mock(),
}));

mock.module("./config-file.ts", () => ({
  buildSyncConfigDocument: mock((config: unknown) => ({
    document: config,
  })),
  writeValidatedSyncConfig: mock(),
}));

mock.module("#app/lib/filesystem.ts", () => ({
  getPathStats: mock(),
}));

mock.module("./paths.ts", () => ({
  buildConfiguredHomeLocalPath: mock((repoPath: string) => ({
    default: `~/${repoPath}`,
  })),
  buildRepoPathWithinRoot: mock(),
  tryBuildRepoPathWithinRoot: mock(),
  tryNormalizeRepoPathInput: mock(),
}));

mock.module("#app/lib/git.ts", () => ({
  ensureGitRepository: mock(),
}));

mock.module("./runtime.ts", () => ({
  resolveSyncConfigResolutionContext: mock(() => ({
    homeDirectory: process.platform === "win32" ? "C:\\tmp\\home" : "/tmp/home",
    platformKey: "linux",
    readEnv: (_name: string) => undefined as string | undefined,
    xdgConfigHome:
      process.platform === "win32"
        ? "C:\\tmp\\home\\.config"
        : "/tmp/home/.config",
  })),
  resolveSyncPaths: mock(() => ({
    configPath: "/tmp/dotweave/manifest.jsonc",
    homeDirectory: "/tmp/home",
    syncDirectory: "/tmp/dotweave",
  })),
}));

import * as mockedSync from "#app/config/sync.ts";
import * as mockedXdg from "#app/config/xdg.ts";
import * as mockedFilesystem from "#app/lib/filesystem.ts";
import * as mockedGit from "#app/lib/git.ts";
import * as mockedPath from "#app/lib/path.ts";
import * as mockedConfigFile from "./config-file.ts";
import * as mockedPaths from "./paths.ts";

import { resolveSetTarget, setTargetMode } from "./set.ts";

type MockFn = ReturnType<typeof mock>;

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
  localPath: nativePath("/tmp/home/.config/app"),
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
  localPath: nativePath("/tmp/home/.gitconfig"),
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
} as unknown as Stats;

const fileStats = {
  isDirectory: () => false,
} as unknown as Stats;

afterEach(() => {
  mock.clearAllMocks();
});

describe("sync set service", () => {
  it("rejects blank set targets", async () => {
    await expect(
      resolveSetTarget(
        "   ",
        createConfig([]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).rejects.toThrowError("Target path is required.");
  });

  it("rejects missing explicit local targets", async () => {
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(true);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      nativePath("/tmp/home/.ssh/id_ed25519"),
    );
    (mockedPaths.buildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      ".ssh/id_ed25519",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(undefined);

    await expect(
      resolveSetTarget(
        nativePath("/tmp/home/.ssh/id_ed25519"),
        createConfig([]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).rejects.toThrowError("Sync set target does not exist.");
  });

  it("resolves explicit child paths inside tracked directories", async () => {
    const entry = directoryEntry();

    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(true);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      nativePath("/tmp/home/.config/app/config.json"),
    );
    (mockedPaths.buildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      ".config/app/config.json",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(entry);
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValue(
      "config.json",
    );

    await expect(
      resolveSetTarget(
        nativePath("/tmp/home/.config/app/config.json"),
        createConfig([entry]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).resolves.toEqual({
      entry,
      localPath: nativePath("/tmp/home/.config/app/config.json"),
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

    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(true);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      nativePath("/tmp/home/.config/app/config.json"),
    );
    (mockedPaths.buildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      ".config/app/config.json",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        nativePath("/tmp/home/.config/app/config.json"),
        createConfig([entry]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).resolves.toEqual({
      entry,
      localPath: nativePath("/tmp/home/.config/app/config.json"),
      relativePath: "config.json",
      repoPath: "profiles/shared/app/config.json",
      stats: fileStats,
    });
  });

  it("rejects explicit local targets outside tracked directories", async () => {
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(true);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      nativePath("/tmp/home/.config/other/file"),
    );
    (mockedPaths.buildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      ".config/other/file",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        nativePath("/tmp/home/.config/other/file"),
        createConfig([directoryEntry()]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).rejects.toThrowError(
      "Local set target is not inside a tracked directory entry.",
    );
  });

  it("rejects invalid repository-style targets", async () => {
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce("../outside");
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      undefined,
    );

    await expect(
      resolveSetTarget(
        "../outside",
        createConfig([]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).rejects.toThrowError(
      "Sync set target is not a valid local or repository path.",
    );
  });

  it("resolves exact repository entries without changing the local path", async () => {
    const entry = fileEntry();

    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(".gitconfig");
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".gitconfig",
    );
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);

    await expect(
      resolveSetTarget(
        ".gitconfig",
        createConfig([entry]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).resolves.toEqual({
      entry,
      localPath: nativePath("/tmp/home/.gitconfig"),
      relativePath: "",
      repoPath: ".gitconfig",
      stats: fileStats,
    });
  });

  it("resolves nested repository targets under tracked directories", async () => {
    const entry = directoryEntry();

    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      ".config/app/nested/config.json",
    );
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".config/app/nested/config.json",
    );
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(entry);
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValue(
      "nested/config.json",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);

    await expect(
      resolveSetTarget(
        ".config/app/nested/config.json",
        createConfig([entry]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).resolves.toEqual({
      entry,
      localPath: nativePath("/tmp/home/.config/app/nested/config.json"),
      relativePath: "nested/config.json",
      repoPath: ".config/app/nested/config.json",
      stats: fileStats,
    });
  });

  it("rejects repository targets that are not tracked", async () => {
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      ".config/other/file",
    );
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".config/other/file",
    );
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(undefined);

    await expect(
      resolveSetTarget(
        ".config/other/file",
        createConfig([directoryEntry()]),
        nativePath("/tmp/cwd"),
        nativePath("/tmp/home"),
      ),
    ).rejects.toThrowError(
      "Repository set target is not inside a tracked directory entry.",
    );
  });

  it("returns unchanged for exact entries that already use the requested mode", async () => {
    const entry = fileEntry();
    const config = createConfig([entry]);

    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce(config);
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(".gitconfig");
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".gitconfig",
    );
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);

    await expect(
      setTargetMode(
        { mode: "secret", target: ".gitconfig" },
        nativePath("/tmp/cwd"),
      ),
    ).resolves.toEqual({
      action: "unchanged",
      configPath: "/tmp/dotweave/manifest.jsonc",
      entryRepoPath: ".gitconfig",
      localPath: nativePath("/tmp/home/.gitconfig"),
      mode: "secret",
      repoPath: ".gitconfig",
      syncDirectory: "/tmp/dotweave",
    });
    expect(mockedConfigFile.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });

  it("rewrites exact entries when platform-specific overrides should be cleared", async () => {
    const entry = fileEntry({
      configuredMode: { default: "secret", linux: "ignore" },
    });
    const config = createConfig([entry]);

    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce(config);
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(".gitconfig");
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".gitconfig",
    );
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);

    const result = await setTargetMode(
      { mode: "secret", target: ".gitconfig" },
      nativePath("/tmp/cwd"),
    );

    expect(result.action).toBe("updated");
    expect(mockedConfigFile.buildSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        {
          ...entry,
          configuredMode: { default: "secret" },
          mode: "secret",
        },
      ],
    });
    expect(mockedConfigFile.writeValidatedSyncConfig).toHaveBeenCalled();
  });

  it("adds a child override when a nested target needs a different mode", async () => {
    const entry = directoryEntry();
    const config = createConfig([entry]);

    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce(config);
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      ".config/app/private.txt",
    );
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".config/app/private.txt",
    );
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(entry);
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValue(
      "private.txt",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(fileStats);

    const result = await setTargetMode(
      { mode: "secret", target: ".config/app/private.txt" },
      nativePath("/tmp/cwd"),
    );

    expect(result).toEqual({
      action: "added",
      configPath: "/tmp/dotweave/manifest.jsonc",
      entryRepoPath: ".config/app",
      localPath: nativePath("/tmp/home/.config/app/private.txt"),
      mode: "secret",
      repoPath: ".config/app/private.txt",
      syncDirectory: "/tmp/dotweave",
    });
    expect(mockedConfigFile.buildSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        entry,
        {
          configuredLocalPath: { default: "~/.config/app/private.txt" },
          configuredMode: { default: "secret" },
          kind: "file",
          localPath: nativePath("/tmp/home/.config/app/private.txt"),
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

    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce(config);
    (mockedPath.isExplicitLocalPath as MockFn).mockReturnValueOnce(false);
    (mockedXdg.expandHomePath as MockFn).mockReturnValueOnce(
      ".config/app/notes.txt",
    );
    (mockedPaths.tryBuildRepoPathWithinRoot as MockFn).mockReturnValueOnce(
      undefined,
    );
    (mockedPaths.tryNormalizeRepoPathInput as MockFn).mockReturnValueOnce(
      ".config/app/notes.txt",
    );
    (mockedSync.findOwningSyncEntry as MockFn).mockReturnValueOnce(entry);
    (mockedSync.resolveEntryRelativeRepoPath as MockFn).mockReturnValue(
      "notes.txt",
    );
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValueOnce(
      directoryStats,
    );

    await expect(
      setTargetMode(
        { mode: "normal", target: ".config/app/notes.txt" },
        nativePath("/tmp/cwd"),
      ),
    ).resolves.toEqual({
      action: "unchanged",
      configPath: "/tmp/dotweave/manifest.jsonc",
      entryRepoPath: ".config/app",
      localPath: nativePath("/tmp/home/.config/app/notes.txt"),
      mode: "normal",
      repoPath: ".config/app/notes.txt",
      syncDirectory: "/tmp/dotweave",
    });
    expect(mockedConfigFile.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });
});
