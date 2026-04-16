import { describe, expect, it, vi, beforeEach } from "vitest";
import { trackTarget } from "./track.ts";
import { DevsyncError } from "#app/lib/error.ts";

const mocked = vi.hoisted(() => ({
  getPathStats: vi.fn(),
  ensureGitRepository: vi.fn(),
  readSyncConfig: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/devsync",
    configPath: "/tmp/devsync/manifest.jsonc",
  })),
  resolveSyncConfigResolutionContext: vi.fn(() => ({
    homeDirectory: "/home/user",
  })),
  buildSyncConfigDocument: vi.fn((config) => config),
  resolveDefaultIdentityFile: vi.fn(() => "/home/user/.ssh/id_rsa"),
  readEnvValue: vi.fn((key) => {
    if (key === "HOME") return "/home/user";
    if (key === "XDG_CONFIG_HOME") return "/home/user/.config";
    return undefined;
  }),
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  getPathStats: mocked.getPathStats,
}));

vi.mock("#app/lib/git.ts", () => ({
  ensureGitRepository: mocked.ensureGitRepository,
}));

vi.mock("#app/config/sync.ts", () => ({
  readSyncConfig: mocked.readSyncConfig,
  normalizeSyncProfileName: vi.fn((s) => s),
  normalizeSyncRepoPath: vi.fn((s) => s),
}));

vi.mock("./config-file.ts", () => ({
  buildSyncConfigDocument: mocked.buildSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("./runtime.ts", () => ({
  resolveSyncConfigResolutionContext: mocked.resolveSyncConfigResolutionContext,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

vi.mock("#app/config/identity-file.ts", () => ({
  resolveDefaultIdentityFile: mocked.resolveDefaultIdentityFile,
}));

vi.mock("#app/config/runtime-env.ts", () => ({
  readEnvValue: mocked.readEnvValue,
}));

vi.mock("#app/lib/path.ts", () => ({
  doPathsOverlap: vi.fn(() => false),
}));

vi.mock("./paths.ts", () => ({
  buildRepoPathWithinRoot: vi.fn((target) => target.replace("/home/user/", "")),
  buildConfiguredHomeLocalPath: vi.fn((p) => `~/${p}`),
}));

describe("track service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      { target: "/home/user/.bashrc", mode: "normal" },
      "/home/user"
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.localPath).toBe("/home/user/.bashrc");
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalled();
  });

  it("throws error for missing target", async () => {
    mocked.getPathStats.mockResolvedValue(undefined);

    await expect(
      trackTarget({ target: "/home/user/missing", mode: "normal" }, "/home/user")
    ).rejects.toThrow(DevsyncError);
  });

  it("detects when a target is already tracked", async () => {
    const localPath = "/home/user/.bashrc";
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
      "/home/user"
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(false);
  });

  it("updates existing entry if mode changes", async () => {
    const localPath = "/home/user/.bashrc";
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
      "/home/user"
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.mode).toBe("secret");
  });
});
