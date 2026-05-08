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
}));

vi.mock("#app/lib/path.ts", () => ({
  doPathsOverlap: vi.fn(),
}));

vi.mock("./sync-paths.ts", () => ({
  buildRepoPathWithinRoot: vi.fn((target, homeDirectory) =>
    target.slice(homeDirectory.length + 1).replaceAll("\\", "/"),
  ),
  buildConfiguredHomeLocalPath: vi.fn((p) => `~/${p}`),
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

  it("throws error for missing target", async () => {
    mocked.getPathStats.mockResolvedValue(undefined);

    await expect(
      trackTarget(
        {
          target:
            process.platform === "win32"
              ? "C:\\home\\user\\missing"
              : "/home/user/missing",
          mode: "normal",
        },
        mocked.homeDirectory,
      ),
    ).rejects.toThrow(DotweaveError);
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
      { target: linkPath, mode: "normal" },
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

  it("updates existing entry repoPath when re-tracking with --repo-path", async () => {
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
      { target: localPath, mode: "normal", repoPath: "dotfiles/bashrc" },
      mocked.homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.repoPath).toBe("dotfiles/bashrc");
  });
});
