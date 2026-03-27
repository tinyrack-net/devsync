import { describe, expect, it } from "vitest";

import { buildPushPlanPreview, buildPushResultFromPlan } from "./push.ts";

describe("push helpers", () => {
  it("builds a stable preview from created and deleted repository artifacts", () => {
    expect(
      buildPushPlanPreview({
        artifacts: [],
        counts: {
          directoryCount: 1,
          encryptedFileCount: 1,
          plainFileCount: 2,
          symlinkCount: 1,
        },
        deletedArtifactCount: 2,
        desiredArtifactKeys: new Set([
          "alpha",
          "beta",
          "gamma",
          "delta",
          "epsilon",
        ]),
        existingArtifactKeys: new Set(["alpha", "stale-a", "stale-b"]),
        snapshot: new Map([
          [
            "zeta",
            {
              contents: new Uint8Array(),
              executable: false,
              secret: false,
              type: "file",
            },
          ],
          ["alpha", { type: "directory" }],
          ["beta", { linkTarget: "value.txt", type: "symlink" }],
          [
            "gamma",
            {
              contents: new Uint8Array(),
              executable: false,
              secret: true,
              type: "file",
            },
          ],
          [
            "delta",
            {
              contents: new Uint8Array(),
              executable: false,
              secret: false,
              type: "file",
            },
          ],
        ]),
      }),
    ).toEqual(["alpha", "beta", "delta", "gamma", "stale-a", "stale-b"]);
  });

  it("builds push results from a completed plan", () => {
    expect(
      buildPushResultFromPlan(
        {
          artifacts: [],
          counts: {
            directoryCount: 2,
            encryptedFileCount: 3,
            plainFileCount: 4,
            symlinkCount: 1,
          },
          deletedArtifactCount: 5,
          desiredArtifactKeys: new Set(),
          existingArtifactKeys: new Set(),
          snapshot: new Map(),
        },
        "/tmp/devsync",
        false,
      ),
    ).toEqual({
      configPath: "/tmp/devsync/manifest.json",
      deletedArtifactCount: 5,
      directoryCount: 2,
      dryRun: false,
      encryptedFileCount: 3,
      plainFileCount: 4,
      symlinkCount: 1,
      syncDirectory: "/tmp/devsync",
    });
  });
});
