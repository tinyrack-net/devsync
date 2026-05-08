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
        false,
      ),
    ).toEqual({
      deletedArtifactCount: 5,
      directoryCount: 2,
      dryRun: false,
      encryptedFileCount: 3,
      plainFileCount: 4,
      symlinkCount: 1,
    });
  });

  it("preview limits to 6 items maximum", () => {
    const snapshot = new Map([
      ["a1", { type: "directory" as const }],
      ["a2", { type: "directory" as const }],
      ["a3", { type: "directory" as const }],
      ["a4", { type: "directory" as const }],
      ["a5", { type: "directory" as const }],
    ]);
    const existingArtifactKeys = new Set([
      "a1",
      "stale-1",
      "stale-2",
      "stale-3",
      "stale-4",
      "stale-5",
    ]);
    const desiredArtifactKeys = new Set(["a1", "a2", "a3", "a4", "a5"]);
    const result = buildPushPlanPreview({
      artifacts: [],
      counts: {
        directoryCount: 5,
        encryptedFileCount: 0,
        plainFileCount: 0,
        symlinkCount: 0,
      },
      deletedArtifactCount: 5,
      desiredArtifactKeys,
      existingArtifactKeys,
      snapshot,
    });
    expect(result.length).toBeLessThanOrEqual(6);
    expect(result).toEqual(["a1", "a2", "a3", "a4", "stale-1", "stale-2"]);
  });

  it("preview returns empty array when plan has no changes", () => {
    expect(
      buildPushPlanPreview({
        artifacts: [],
        counts: {
          directoryCount: 0,
          encryptedFileCount: 0,
          plainFileCount: 0,
          symlinkCount: 0,
        },
        deletedArtifactCount: 0,
        desiredArtifactKeys: new Set(),
        existingArtifactKeys: new Set(),
        snapshot: new Map(),
      }),
    ).toEqual([]);
  });

  it("buildPushResultFromPlan with dryRun=true sets dryRun field", () => {
    expect(
      buildPushResultFromPlan(
        {
          artifacts: [],
          counts: {
            directoryCount: 0,
            encryptedFileCount: 0,
            plainFileCount: 0,
            symlinkCount: 0,
          },
          deletedArtifactCount: 0,
          desiredArtifactKeys: new Set(),
          existingArtifactKeys: new Set(),
          snapshot: new Map(),
        },
        true,
      ),
    ).toEqual({
      deletedArtifactCount: 0,
      directoryCount: 0,
      dryRun: true,
      encryptedFileCount: 0,
      plainFileCount: 0,
      symlinkCount: 0,
    });
  });

  it("buildPushPlanPreview sorts keys alphabetically", () => {
    expect(
      buildPushPlanPreview({
        artifacts: [],
        counts: {
          directoryCount: 3,
          encryptedFileCount: 0,
          plainFileCount: 0,
          symlinkCount: 0,
        },
        deletedArtifactCount: 0,
        desiredArtifactKeys: new Set(["zeta", "alpha", "mid"]),
        existingArtifactKeys: new Set(["zeta", "alpha", "mid"]),
        snapshot: new Map([
          ["zeta", { type: "directory" }],
          ["alpha", { type: "directory" }],
          ["mid", { type: "directory" }],
        ]),
      }),
    ).toEqual(["alpha", "mid", "zeta"]);
  });

  it("preview shows created keys first then deleted keys", () => {
    const result = buildPushPlanPreview({
      artifacts: [],
      counts: {
        directoryCount: 2,
        encryptedFileCount: 0,
        plainFileCount: 0,
        symlinkCount: 0,
      },
      deletedArtifactCount: 2,
      desiredArtifactKeys: new Set(["bravo", "charlie"]),
      existingArtifactKeys: new Set(["bravo", "charlie", "stale-x", "stale-z"]),
      snapshot: new Map([
        ["bravo", { type: "directory" }],
        ["charlie", { type: "directory" }],
      ]),
    });
    const lastCreatedIndex = Math.max(
      result.indexOf("bravo"),
      result.indexOf("charlie"),
    );
    const firstDeletedIndex = Math.min(
      result.indexOf("stale-x"),
      result.indexOf("stale-z"),
    );
    expect(lastCreatedIndex).toBeLessThan(firstDeletedIndex);
  });
});
