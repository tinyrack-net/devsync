import { beforeEach, describe, expect, it, mock } from "bun:test";
import { CONSTANTS } from "#app/config/constants.ts";
import type { LoadedSyncConfig } from "./runtime.ts";

mock.module("#app/config/sync.ts", () => ({
  resolveSyncConfigFilePath: mock(() => "/tmp/dotweave/manifest.jsonc"),
}));

mock.module("#app/lib/git.ts", () => ({
  ensureGitRepository: mock(),
}));

mock.module("./runtime.ts", () => ({
  loadSyncConfig: mock(),
  resolveSyncPaths: mock(() => ({
    syncDirectory: "/tmp/dotweave",
  })),
}));

mock.module("./push.ts", () => ({
  buildPushPlan: mock(),
  buildPushResultFromPlan: mock(() => ({ result: "push" })),
  buildPushPlanPreview: mock(() => ["push-preview"]),
}));

mock.module("./pull.ts", () => ({
  buildPullPlan: mock(),
  buildPullResultFromPlan: mock(() => ({ result: "pull" })),
  buildPullPlanPreview: mock(() => ["pull-preview"]),
}));

mock.module("./repo-artifacts.ts", () => ({
  buildArtifactKey: mock(
    (a: { profile: string; repoPath: string }) => `${a.profile}/${a.repoPath}`,
  ),
  isRepoArtifactCurrent: mock(),
  parseArtifactRelativePath: mock((p: string) => ({ repoPath: p })),
}));

import * as mockedGit from "#app/lib/git.ts";
import * as mockedPull from "./pull.ts";
import * as mockedPush from "./push.ts";
import * as mockedRepoArtifacts from "./repo-artifacts.ts";
import * as mockedRuntime from "./runtime.ts";

import { getStatus } from "./status.ts";

type MockFn = ReturnType<typeof mock>;

describe("status service", () => {
  beforeEach(() => {
    mock.clearAllMocks();
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

    (mockedRuntime.loadSyncConfig as MockFn).mockResolvedValue(mockConfig);
    (mockedPush.buildPushPlan as MockFn).mockResolvedValue({
      artifacts: [{ profile: "default", repoPath: ".bashrc", kind: "file" }],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(["default/.bashrc"]),
    });
    (mockedPull.buildPullPlan as MockFn).mockResolvedValue({
      updatedLocalPaths: ["/home/user/.bashrc"],
      deletedLocalPaths: [],
    });
    (mockedRepoArtifacts.isRepoArtifactCurrent as MockFn).mockResolvedValue(
      false,
    );

    const result = await getStatus();

    expect(result.activeProfile).toBe("default");
    expect(result.entryCount).toBe(1);
    expect(result.push.changes.added).toContain(".bashrc");
    expect(result.pull.changes.updated).toContain("/home/user/.bashrc");
    expect(mockedGit.ensureGitRepository).toHaveBeenCalledWith("/tmp/dotweave");
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

    (mockedRuntime.loadSyncConfig as MockFn).mockResolvedValue(mockConfig);
    (mockedPush.buildPushPlan as MockFn).mockResolvedValue({
      artifacts: [],
      existingArtifactKeys: new Set(),
      desiredArtifactKeys: new Set(),
    });
    (mockedPull.buildPullPlan as MockFn).mockResolvedValue({
      updatedLocalPaths: [],
      deletedLocalPaths: [],
    });

    const result = await getStatus();

    expect(result.activeProfile).toBeUndefined();
    expect(result.entryCount).toBe(0);
  });
});
