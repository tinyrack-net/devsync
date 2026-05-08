import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppConstants } from "#app/config/constants.ts";
import { getStatus } from "./status.ts";
import type { LoadedSyncConfig } from "./sync-context.ts";

const mocked = vi.hoisted(() => ({
  resolveSyncConfigFilePath: vi.fn(() => "/tmp/dotweave/manifest.jsonc"),
  requireGitRepository: vi.fn(),
  loadSyncConfig: vi.fn(),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/dotweave",
  })),
  buildPushPlan: vi.fn(),
  buildPullPlan: vi.fn(),
  isRepoArtifactCurrent: vi.fn(),
  buildArtifactKey: vi.fn(
    (a: { profile: string; repoPath: string }) => `${a.profile}/${a.repoPath}`,
  ),
  buildPushResultFromPlan: vi.fn(() => ({ result: "push" })),
  buildPullResultFromPlan: vi.fn(() => ({ result: "pull" })),
  buildPushPlanPreview: vi.fn(() => ["push-preview"]),
  buildPullPlanPreview: vi.fn(() => ["pull-preview"]),
}));

vi.mock("#app/config/sync-schema.ts", () => ({
  resolveSyncConfigFilePath: mocked.resolveSyncConfigFilePath,
}));

vi.mock("#app/lib/git.ts", () => ({
  requireGitRepository: mocked.requireGitRepository,
}));

vi.mock("./sync-context.ts", () => ({
  loadSyncConfig: mocked.loadSyncConfig,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

vi.mock("./push.ts", () => ({
  buildPushPlan: mocked.buildPushPlan,
  buildPushResultFromPlan: mocked.buildPushResultFromPlan,
  buildPushPlanPreview: mocked.buildPushPlanPreview,
}));

vi.mock("./pull.ts", () => ({
  buildPullPlan: mocked.buildPullPlan,
  buildPullResultFromPlan: mocked.buildPullResultFromPlan,
  buildPullPlanPreview: mocked.buildPullPlanPreview,
}));

vi.mock("./repo-artifacts.ts", () => ({
  buildArtifactKey: mocked.buildArtifactKey,
  isRepoArtifactCurrent: mocked.isRepoArtifactCurrent,
  parseArtifactRelativePath: vi.fn((p: string) => ({ repoPath: p })),
}));

describe("status service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully returns status result", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [
          {
            kind: "file",
            localPath: "/home/user/.bashrc",
            profiles: ["default"],
            mode: "normal",
            repoPath: ".bashrc",
            profilesExplicit: true,
            modeExplicit: true,
            permissionExplicit: false,
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.bashrc" },
          },
        ],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [{ profile: "default", repoPath: ".bashrc", kind: "file" }],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(["default/.bashrc"]),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: ["/home/user/.bashrc"],
      deletedLocalPaths: [],
    });
    mocked.isRepoArtifactCurrent.mockResolvedValue(false);

    const result = await getStatus();

    expect(result.activeProfile).toBe("default");
    expect(result.entryCount).toBe(1);
    expect(result.push.changes.added).toContain(".bashrc");
    expect(result.pull.changes.updated).toContain("/home/user/.bashrc");
    expect(mocked.requireGitRepository).toHaveBeenCalledWith("/tmp/dotweave");
  });

  it("handles empty active profile", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        age: { identityFile: "key.txt", recipients: [] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: [],
    });

    const result = await getStatus();

    expect(result.activeProfile).toBeUndefined();
    expect(result.entryCount).toBe(0);
  });

  it("reports push changes with modified artifacts when artifacts are not current", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [
          {
            kind: "file",
            localPath: "/home/user/.vimrc",
            profiles: ["default"],
            mode: "normal",
            repoPath: ".vimrc",
            profilesExplicit: true,
            modeExplicit: true,
            permissionExplicit: false,
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.vimrc" },
          },
        ],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [{ profile: "default", repoPath: ".vimrc", kind: "file" }],
      existingArtifactKeys: new Set(["default/.vimrc"]),
      desiredArtifactKeys: new Set(["default/.vimrc"]),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: [],
    });
    mocked.isRepoArtifactCurrent.mockResolvedValue(false);

    const result = await getStatus();

    expect(result.push.changes.modified).toContain(".vimrc");
    expect(result.push.changes.added).not.toContain(".vimrc");
  });

  it("reports push changes with deleted artifacts for stale keys", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [],
      existingArtifactKeys: new Set([
        "default/.oldconfig",
        "default/.obsolete",
      ]),
      desiredArtifactKeys: new Set(),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: [],
    });

    const result = await getStatus();

    expect(result.push.changes.deleted).toContain("default/.oldconfig");
    expect(result.push.changes.deleted).toContain("default/.obsolete");
  });

  it("reports pull changes including deleted local paths", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: ["/home/user/.deprecated", "/home/user/.removed"],
    });

    const result = await getStatus();

    expect(result.pull.changes.deleted).toContain("/home/user/.deprecated");
    expect(result.pull.changes.deleted).toContain("/home/user/.removed");
  });

  it("includes recipientCount from effective config age", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip1", "recip2"] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: [],
    });

    const result = await getStatus();

    expect(result.recipientCount).toBe(2);
  });

  it("returns full config entry metadata (kind, mode, profiles)", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        version: AppConstants.SYNC.CONFIG_VERSION,
        entries: [
          {
            kind: "file",
            localPath: "/home/user/.bashrc",
            profiles: ["default", "linux"],
            mode: "normal",
            repoPath: ".bashrc",
            profilesExplicit: true,
            modeExplicit: true,
            permissionExplicit: false,
            configuredMode: { default: "normal", linux: "normal" },
            configuredLocalPath: { default: "~/.bashrc", linux: "~/.bashrc" },
          },
        ],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(),
    });
    mocked.buildPullPlan.mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: [],
    });

    const result = await getStatus();

    expect(result.entries[0]).toEqual({
      kind: "file",
      localPath: "/home/user/.bashrc",
      profiles: ["default", "linux"],
      mode: "normal",
      repoPath: ".bashrc",
    });
  });
});
