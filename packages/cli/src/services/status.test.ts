import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSTANTS } from "#app/config/constants.ts";
import type { LoadedSyncConfig } from "./runtime.ts";
import { getStatus } from "./status.ts";

const mocked = vi.hoisted(() => ({
  resolveSyncConfigFilePath: vi.fn(() => "/tmp/dotweave/manifest.jsonc"),
  ensureGitRepository: vi.fn(),
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

vi.mock("#app/config/sync.ts", () => ({
  resolveSyncConfigFilePath: mocked.resolveSyncConfigFilePath,
}));

vi.mock("#app/lib/git.ts", () => ({
  ensureGitRepository: mocked.ensureGitRepository,
}));

vi.mock("./runtime.ts", () => ({
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
        version: CONSTANTS.SYNC.CONFIG_VERSION,
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        version: CONSTANTS.SYNC.CONFIG_VERSION,
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
    expect(mocked.ensureGitRepository).toHaveBeenCalledWith("/tmp/dotweave");
  });

  it("handles empty active profile", async () => {
    const mockConfig: LoadedSyncConfig = {
      effectiveConfig: {
        version: CONSTANTS.SYNC.CONFIG_VERSION,
        age: { identityFile: "key.txt", recipients: [] },
        entries: [],
      },
      fullConfig: {
        version: CONSTANTS.SYNC.CONFIG_VERSION,
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
});
