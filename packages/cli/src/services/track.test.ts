import { beforeEach, describe, expect, it, vi } from "vitest";
import { DotweaveError } from "#app/lib/error.ts";
import { doPathsOverlap } from "#app/lib/path.ts";
import { trackTarget } from "./track.ts";

const mocked = vi.hoisted(() => ({
  bashrcPath:
    process.platform === "win32"
      ? "C:\\home\\user\\.bashrc"
      : "/home/user/.bashrc",
  homeDirectory: process.platform === "win32" ? "C:\\home\\user" : "/home/user",
  getPathStats: vi.fn(),
  requireGitRepository: vi.fn(),
  readSyncConfig: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
  buildDefaultPlatformMode: vi.fn((mode: string) => ({ default: mode })),
  hasPlatformSpecificModeOverride: vi.fn(() => false),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/dotweave",
    configPath: "/tmp/dotweave/manifest.jsonc",
  })),
  resolveSyncConfigResolutionContext: vi.fn(() => ({
    homeDirectory:
      process.platform === "win32" ? "C:\\home\\user" : "/home/user",
    platformKey: "linux",
  })),
  buildSyncConfigDocument: vi.fn((config) => config),
  resolveDefaultIdentityFile: vi.fn(() =>
    process.platform === "win32"
      ? "C:\\home\\user\\.ssh\\id_rsa"
      : "/home/user/.ssh/id_rsa",
  ),
  readEnvValue: vi.fn((key) => {
    if (key === "HOME") {
      return process.platform === "win32" ? "C:\\home\\user" : "/home/user";
    }
    if (key === "XDG_CONFIG_HOME") {
      return process.platform === "win32"
        ? "C:\\home\\user\\.config"
        : "/home/user/.config";
    }
    return undefined;
  }),
  resolveDotweaveHomeDirectory: vi.fn(() => "/home/user/.config/dotweave"),
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  getPathStats: mocked.getPathStats,
}));

vi.mock("#app/lib/git.ts", () => ({
  requireGitRepository: mocked.requireGitRepository,
}));

vi.mock("#app/config/sync-queries.ts", () => ({
  buildDefaultPlatformMode: mocked.buildDefaultPlatformMode,
  hasPlatformSpecificModeOverride: mocked.hasPlatformSpecificModeOverride,
}));

vi.mock("#app/config/sync-schema.ts", () => ({
  normalizeSyncProfileName: vi.fn((s) => s),
  normalizeSyncRepoPath: vi.fn((s) => s),
  readSyncConfig: mocked.readSyncConfig,
}));

vi.mock("./config-file.ts", () => ({
  buildSyncConfigDocument: mocked.buildSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("./sync-context.ts", () => {
  const loadWritableSyncConfig = vi.fn(async () => {
    const paths = mocked.resolveSyncPaths();
    await mocked.requireGitRepository(paths.syncDirectory);
    const config = await mocked.readSyncConfig(
      paths.syncDirectory,
      mocked.resolveSyncConfigResolutionContext(),
    );
    return {
      config,
      configPath: paths.configPath,
      context: mocked.resolveSyncConfigResolutionContext(),
      syncDirectory: paths.syncDirectory,
    };
  });

  return {
    resolveSyncConfigResolutionContext:
      mocked.resolveSyncConfigResolutionContext,
    resolveSyncPaths: mocked.resolveSyncPaths,
    loadWritableSyncConfig,
  };
});

vi.mock("#app/config/identity-file.ts", () => ({
  resolveDefaultIdentityFile: mocked.resolveDefaultIdentityFile,
}));

vi.mock("#app/config/runtime-env.ts", () => ({
  readEnvValue: mocked.readEnvValue,
  resolveDotweaveHomeDirectoryFromEnv: mocked.resolveDotweaveHomeDirectory,
}));

vi.mock("#app/lib/path.ts", () => ({
  doPathsOverlap: vi.fn(),
}));

vi.mock("./sync-paths.ts", () => ({
  buildRepoPathWithinRoot: vi.fn((target, homeDirectory) =>
    target.slice(homeDirectory.length + 1).replaceAll("\\", "/"),
  ),
  buildConfiguredHomeLocalPath: vi.fn((p) => ({ default: `~/${p}` })),
}));

describe("track service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(doPathsOverlap).mockReturnValue(false);
  });

  it("successfully tracks a new file", async () => {
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
      profiles: ["work", "personal"],
    });

    const result = await trackTarget(
      { target: mocked.bashrcPath, mode: "normal" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.localPath).toBe(mocked.bashrcPath);
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalled();
  });

  it("throws TARGET_KIND_REQUIRED for missing target without kind", async () => {
    mocked.getPathStats.mockResolvedValue(undefined);
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    let thrownError: DotweaveError | undefined;

    try {
      await trackTarget(
        {
          target:
            process.platform === "win32"
              ? "C:\\home\\user\\missing"
              : "/home/user/missing",
          mode: "normal",
        },
        mocked.homeDirectory,
      );
    } catch (error) {
      thrownError = error as DotweaveError;
    }

    expect(thrownError).toBeInstanceOf(DotweaveError);
    expect(thrownError?.code).toBe("TARGET_KIND_REQUIRED");
  });

  it("tracks a missing target as a file when kind is explicit", async () => {
    const missingPath =
      process.platform === "win32"
        ? "C:\\home\\user\\future.toml"
        : "/home/user/future.toml";
    mocked.getPathStats.mockResolvedValue(undefined);
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      { target: missingPath, mode: "normal", kind: "file" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.kind).toBe("file");
    expect(result.localPath).toBe(missingPath);
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [expect.objectContaining({ kind: "file" })],
      }),
    );
  });

  it("tracks a missing target as a directory when kind is explicit", async () => {
    const missingPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.config\\future"
        : "/home/user/.config/future";
    mocked.getPathStats.mockResolvedValue(undefined);
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      { target: missingPath, mode: "normal", kind: "directory" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.kind).toBe("directory");
    expect(result.localPath).toBe(missingPath);
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [expect.objectContaining({ kind: "directory" })],
      }),
    );
  });

  it("throws TARGET_KIND_MISMATCH when an existing file is requested as a directory", async () => {
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    let thrownError: DotweaveError | undefined;

    try {
      await trackTarget(
        { target: mocked.bashrcPath, mode: "normal", kind: "directory" },
        mocked.homeDirectory,
      );
    } catch (error) {
      thrownError = error as DotweaveError;
    }

    expect(thrownError).toBeInstanceOf(DotweaveError);
    expect(thrownError?.code).toBe("TARGET_KIND_MISMATCH");
  });

  it("throws TARGET_KIND_MISMATCH when an existing directory is requested as a file", async () => {
    const dirPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.config\\app"
        : "/home/user/.config/app";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    let thrownError: DotweaveError | undefined;

    try {
      await trackTarget(
        { target: dirPath, mode: "normal", kind: "file" },
        mocked.homeDirectory,
      );
    } catch (error) {
      thrownError = error as DotweaveError;
    }

    expect(thrownError).toBeInstanceOf(DotweaveError);
    expect(thrownError?.code).toBe("TARGET_KIND_MISMATCH");
  });

  it("detects when a target is already tracked", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      { target: localPath, mode: "normal" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(false);
  });

  it("updates existing entry if mode changes", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      { target: localPath, mode: "secret" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.mode).toBe("secret");
  });

  it("tracks a new file with explicit permission", async () => {
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
      profiles: ["work", "personal"],
    });

    const result = await trackTarget(
      {
        target: mocked.bashrcPath,
        mode: "normal",
        permission: { default: "0600" },
      },
      mocked.homeDirectory,
    );

    expect(result.configuredPermission).toEqual({ default: "0600" });
    expect(result.permission).toBe(0o600);
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredPermission: { default: "0600" },
            permission: 0o600,
            permissionExplicit: true,
          }),
        ],
      }),
    );
  });

  it("updates existing entry permission when requested", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
          configuredPermission: { default: "0644" },
          permission: 0o644,
          permissionExplicit: true,
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      {
        target: localPath,
        mode: "normal",
        permission: { default: "0600" },
      },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.configuredPermission).toEqual({ default: "0600" });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredPermission: { default: "0600" },
            permission: 0o600,
            permissionExplicit: true,
          }),
        ],
      }),
    );
  });

  it("preserves existing permission when permission is omitted", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
          configuredPermission: { default: "0600" },
          permission: 0o600,
          permissionExplicit: true,
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      { target: localPath, mode: "normal" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.configuredPermission).toEqual({ default: "0600" });
    expect(mocked.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });

  it("successfully tracks a new directory", async () => {
    const dirPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.config\\app"
        : "/home/user/.config/app";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
      profiles: ["work", "personal"],
    });

    const result = await trackTarget(
      { target: dirPath, mode: "normal" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.kind).toBe("directory");
    expect(result.localPath).toBe(dirPath);
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalled();
  });

  it("successfully tracks a symlink as a file entry", async () => {
    const linkPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.local\\bin\\app"
        : "/home/user/.local/bin/app";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => true,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      { target: linkPath, mode: "normal", kind: "file" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.kind).toBe("file");
    expect(result.localPath).toBe(linkPath);
  });

  it("throws TARGET_UNSUPPORTED_TYPE for socket files", async () => {
    mocked.getPathStats.mockResolvedValue({
      isFile: () => false,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    let thrownError: DotweaveError | undefined;

    try {
      await trackTarget(
        { target: mocked.bashrcPath, mode: "normal" },
        mocked.homeDirectory,
      );
    } catch (error) {
      thrownError = error as DotweaveError;
    }

    expect(thrownError).toBeInstanceOf(DotweaveError);
    expect(thrownError?.code).toBe("TARGET_UNSUPPORTED_TYPE");
  });

  it("throws TARGET_OVERLAPS_SYNC_DIR when target overlaps the sync directory", async () => {
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });
    vi.mocked(doPathsOverlap).mockReturnValue(true);

    let thrownError: DotweaveError | undefined;

    try {
      await trackTarget(
        { target: mocked.bashrcPath, mode: "normal" },
        mocked.homeDirectory,
      );
    } catch (error) {
      thrownError = error as DotweaveError;
    }

    expect(thrownError).toBeInstanceOf(DotweaveError);
    expect(thrownError?.code).toBe("TARGET_OVERLAPS_SYNC_DIR");
  });

  it("throws TARGET_OVERLAPS_IDENTITY when target overlaps the identity file", async () => {
    const identityFile =
      process.platform === "win32"
        ? "C:\\home\\user\\.ssh\\id_rsa"
        : "/home/user/.ssh/id_rsa";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: { recipients: ["age1test"] },
    });
    vi.mocked(doPathsOverlap).mockImplementation(
      (target: string, other: string) => {
        if (other === "/tmp/dotweave") return false;
        return target === other;
      },
    );

    let thrownError: DotweaveError | undefined;

    try {
      await trackTarget(
        { target: identityFile, mode: "normal" },
        mocked.homeDirectory,
      );
    } catch (error) {
      thrownError = error as DotweaveError;
    }

    expect(thrownError).toBeInstanceOf(DotweaveError);
    expect(thrownError?.code).toBe("TARGET_OVERLAPS_IDENTITY");
  });

  it("assigns normalized profiles during track", async () => {
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
      profiles: ["work", "personal"],
    });

    const result = await trackTarget(
      {
        target: mocked.bashrcPath,
        mode: "normal",
        profiles: ["work", "personal"],
      },
      mocked.homeDirectory,
    );

    expect(result.profiles).toEqual(["work", "personal"]);
  });

  it("clears profiles when profiles is empty string array", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: ["work"],
          configuredMode: { default: "normal" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      { target: localPath, mode: "normal", profiles: [""] },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.profiles).toEqual([]);
  });

  it("updates existing entry repoPath when re-tracking with --repo", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
          repoPath: ".bashrc",
          configuredRepoPath: { default: ".bashrc" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      {
        target: localPath,
        mode: "normal",
        repoPath: { default: "dotfiles/bashrc" },
      },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.repoPath).toBe("dotfiles/bashrc");
  });

  it("tracks a new entry with repo platform overrides", async () => {
    const dirPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.config\\app"
        : "/home/user/.config/app";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      {
        target: dirPath,
        mode: { default: "normal" },
        repoPath: {
          default: ".config/app",
          win: "AppData/Roaming/App",
        },
      },
      mocked.homeDirectory,
    );

    expect(result.configuredRepoPath).toEqual({
      default: ".config/app",
      win: "AppData/Roaming/App",
    });
    expect(result.repoPath).toBe(".config/app");
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredRepoPath: {
              default: ".config/app",
              win: "AppData/Roaming/App",
            },
          }),
        ],
      }),
    );
  });

  it("merges repo platform overrides into existing entries", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
          repoPath: ".bashrc",
          configuredRepoPath: { default: ".bashrc", mac: "dotfiles/bashrc" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      {
        target: localPath,
        mode: { default: "normal" },
        repoPath: { win: "Documents/bashrc" },
      },
      mocked.homeDirectory,
    );

    expect(result.changed).toBe(true);
    expect(result.configuredRepoPath).toEqual({
      default: ".bashrc",
      mac: "dotfiles/bashrc",
      win: "Documents/bashrc",
    });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredRepoPath: {
              default: ".bashrc",
              mac: "dotfiles/bashrc",
              win: "Documents/bashrc",
            },
          }),
        ],
      }),
    );
  });

  it("tracks a new entry with mode platform overrides", async () => {
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      {
        target: mocked.bashrcPath,
        mode: { default: "normal", win: "ignore" },
      },
      mocked.homeDirectory,
    );

    expect(result.configuredMode).toEqual({ default: "normal", win: "ignore" });
    expect(result.mode).toBe("normal");
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredMode: { default: "normal", win: "ignore" },
          }),
        ],
      }),
    );
  });

  it("merges mode platform overrides into existing entries", async () => {
    const localPath = mocked.bashrcPath;
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "secret",
          profiles: [],
          configuredMode: { default: "secret", mac: "ignore" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      {
        target: localPath,
        mode: { win: "ignore" },
      },
      mocked.homeDirectory,
    );

    expect(result.changed).toBe(true);
    expect(result.configuredMode).toEqual({
      default: "secret",
      mac: "ignore",
      win: "ignore",
    });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredMode: {
              default: "secret",
              mac: "ignore",
              win: "ignore",
            },
          }),
        ],
      }),
    );
  });

  it("tracks a new entry with local platform overrides", async () => {
    const dirPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.config\\app"
        : "/home/user/.config/app";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      {
        target: dirPath,
        mode: { default: "normal" },
        localPathOverrides: { win: "%APPDATA%/App" },
      },
      mocked.homeDirectory,
    );

    expect(result.configuredLocalPath).toEqual({
      default: "~/.config/app",
      win: "%APPDATA%/App",
    });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/dotweave",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            configuredLocalPath: {
              default: "~/.config/app",
              win: "%APPDATA%/App",
            },
          }),
        ],
      }),
    );
  });

  it("detects duplicate repo paths using platform-resolved repo overrides", async () => {
    const dirPath =
      process.platform === "win32"
        ? "C:\\home\\user\\.config\\app"
        : "/home/user/.config/app";
    mocked.getPathStats.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    });
    mocked.readSyncConfig.mockResolvedValue({
      entries: [
        {
          localPath:
            process.platform === "win32"
              ? "C:\\home\\user\\.config\\other"
              : "/home/user/.config/other",
          kind: "directory",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
          repoPath: ".config/app-linux",
        },
      ],
      age: {},
    });

    await expect(
      trackTarget(
        {
          target: dirPath,
          mode: { default: "normal" },
          repoPath: {
            default: ".config/app",
            linux: ".config/app-linux",
          },
        },
        mocked.homeDirectory,
      ),
    ).rejects.toMatchObject({ code: "TARGET_CONFLICT" });
  });
});
