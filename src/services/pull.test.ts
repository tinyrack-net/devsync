import { describe, expect, it } from "vitest";

import { buildPullPlanPreview, buildPullResultFromPlan } from "./pull.js";

describe("pull helpers", () => {
  it("builds a stable preview from desired and deleted local paths", () => {
    expect(
      buildPullPlanPreview({
        counts: {
          decryptedFileCount: 1,
          directoryCount: 1,
          plainFileCount: 2,
          symlinkCount: 0,
        },
        deletedLocalCount: 2,
        desiredKeys: new Set([
          "zeta/file.txt",
          "alpha/file.txt",
          "beta/file.txt",
          "gamma/file.txt",
          "delta/file.txt",
        ]),
        existingKeys: new Set(["alpha/file.txt", "obsolete-a", "obsolete-b"]),
        materializations: [],
      }),
    ).toEqual([
      "alpha/file.txt",
      "beta/file.txt",
      "delta/file.txt",
      "gamma/file.txt",
      "obsolete-a",
      "obsolete-b",
    ]);
  });

  it("builds pull results from a completed plan", () => {
    expect(
      buildPullResultFromPlan(
        {
          counts: {
            decryptedFileCount: 3,
            directoryCount: 1,
            plainFileCount: 2,
            symlinkCount: 0,
          },
          deletedLocalCount: 4,
          desiredKeys: new Set(),
          existingKeys: new Set(),
          materializations: [],
        },
        "/tmp/devsync",
        true,
      ),
    ).toEqual({
      configPath: "/tmp/devsync/manifest.json",
      decryptedFileCount: 3,
      deletedLocalCount: 4,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 2,
      symlinkCount: 0,
      syncDirectory: "/tmp/devsync",
    });
  });
});
