import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONSTANTS } from "#app/config/constants.ts";
import { buildPullPlan } from "./pull.ts";
import { buildPushPlan } from "./push.ts";
import type { EffectiveSyncConfig } from "./runtime.ts";

const mocked = vi.hoisted(() => ({
  buildRepositorySnapshot: vi.fn(),
  buildLocalSnapshot: vi.fn(),
  buildEntryMaterialization: vi.fn(),
  countDeletedLocalNodes: vi.fn(),
  collectChangedLocalPaths: vi.fn(),
}));

vi.mock("./repo-snapshot.ts", () => ({
  buildRepositorySnapshot: mocked.buildRepositorySnapshot,
}));

vi.mock("./local-snapshot.ts", () => ({
  buildLocalSnapshot: mocked.buildLocalSnapshot,
}));

vi.mock("./local-materialization.ts", () => ({
  buildEntryMaterialization: mocked.buildEntryMaterialization,
  countDeletedLocalNodes: mocked.countDeletedLocalNodes,
  collectChangedLocalPaths: mocked.collectChangedLocalPaths,
  buildPullCounts: vi.fn(() => ({})),
}));

describe("sync scenarios (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles multi-profile configuration in pull plan", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          localPath: "/home/user/.ssh/config",
          repoPath: ".ssh/config",
          profiles: ["work", "personal"],
          mode: "normal",
          profilesExplicit: true,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/.ssh/config" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.buildRepositorySnapshot.mockResolvedValue(
      new Map([
        [
          ".ssh/config",
          { type: "file", contents: Buffer.from("work-ssh"), secret: false },
        ],
      ]),
    );
    mocked.buildEntryMaterialization.mockReturnValue({
      type: "file",
      desiredKeys: new Set([".ssh/config"]),
    });
    mocked.collectChangedLocalPaths.mockResolvedValue([
      "/home/user/.ssh/config",
    ]);

    const plan = await buildPullPlan(config, "/tmp/sync");

    expect(plan.updatedLocalPaths).toContain("/home/user/.ssh/config");
    expect(mocked.buildRepositorySnapshot).toHaveBeenCalled();
  });

  it("handles directory with ignored sub-entry in push plan", async () => {
    const config: EffectiveSyncConfig = {
      version: CONSTANTS.SYNC.CONFIG_VERSION,
      activeProfile: "default",
      entries: [
        {
          kind: "directory",
          localPath: "/home/user/app",
          repoPath: "app",
          profiles: [],
          mode: "normal",
          profilesExplicit: false,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/app" },
        },
        {
          kind: "directory",
          localPath: "/home/user/app/node_modules",
          repoPath: "app/node_modules",
          profiles: [],
          mode: "ignore",
          profilesExplicit: false,
          modeExplicit: true,
          permissionExplicit: false,
          configuredMode: { default: "ignore" },
          configuredLocalPath: { default: "~/app/node_modules" },
        },
      ],
      age: { identityFile: "id.txt", recipients: ["key1"] },
    };

    mocked.buildLocalSnapshot.mockResolvedValue(
      new Map([
        ["app", { type: "directory" }],
        [
          "app/main.js",
          { type: "file", contents: Buffer.from("js"), secret: false },
        ],
      ]),
    );

    // In actual implementation, buildLocalSnapshot filters out ignored entries.
    const plan = await buildPushPlan(config, "/tmp/sync");

    const artifactRepoPaths = plan.artifacts.map((a) => a.repoPath);
    expect(artifactRepoPaths).toContain("app");
    expect(artifactRepoPaths).toContain("app/main.js");
    expect(artifactRepoPaths).not.toContain("app/node_modules");
  });
});
