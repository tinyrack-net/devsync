import { describe, expect, it, vi, beforeEach } from "vitest";
import { getStatus } from "./status.ts";

const mocked = vi.hoisted(() => ({
  resolveSyncConfigFilePath: vi.fn(() => "/tmp/devsync/manifest.jsonc"),
  ensureGitRepository: vi.fn(),
  loadSyncConfig: vi.fn(),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/devsync",
  })),
  buildPushPlan: vi.fn(),
  buildPullPlan: vi.fn(),
  isRepoArtifactCurrent: vi.fn(),
  buildArtifactKey: vi.fn((a: any) => `${a.profile}/${a.repoPath}`),
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
    const mockConfig = {
      effectiveConfig: {
        activeProfile: "default",
        age: { identityFile: "key.txt", recipients: ["recip"] },
        entries: [],
      },
      fullConfig: {
        entries: [
          {
            kind: "file",
            localPath: "/home/user/.bashrc",
            profiles: ["default"],
            mode: "normal",
            repoPath: ".bashrc",
          },
        ],
      },
    };

    mocked.loadSyncConfig.mockResolvedValue(mockConfig);
    mocked.buildPushPlan.mockResolvedValue({
      artifacts: [
        { profile: "default", repoPath: ".bashrc", kind: "file" }
      ],
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
    expect(mocked.ensureGitRepository).toHaveBeenCalledWith("/tmp/devsync");
  });

  it("handles empty active profile", async () => {
    const mockConfig = {
      effectiveConfig: {
        age: { identityFile: "key.txt", recipients: [] },
        entries: [],
      },
      fullConfig: {
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
