import { describe, expect, it } from "vitest";

import { migrateSyncConfigV7ToV8 } from "./sync-v8.ts";

describe("sync v8 migration", () => {
  it("normalizes and deduplicates legacy entry profiles for the registry", () => {
    expect(
      migrateSyncConfigV7ToV8({
        version: 7,
        entries: [
          { profiles: [" default ", "work", " work ", "Personal"] },
          { profiles: ["default", "Personal"] },
          { profiles: undefined },
        ],
      }),
    ).toEqual({
      version: 8,
      entries: [
        { profiles: [" default ", "work", " work ", "Personal"] },
        { profiles: ["default", "Personal"] },
        { profiles: undefined },
      ],
      profiles: ["Personal", "work"],
    });
  });

  it("fails before producing a migrated config when a legacy profile name is invalid", () => {
    expect(() =>
      migrateSyncConfigV7ToV8({
        version: 7,
        entries: [{ profiles: ["bad/profile"] }],
      }),
    ).toThrowError("Profile name contains unsupported characters.");
  });

  it("fails before producing a migrated config when a legacy profile value is not a string", () => {
    expect(() =>
      migrateSyncConfigV7ToV8({
        version: 7,
        entries: [{ profiles: ["work", 123] }],
      }),
    ).toThrowError("Profile name must be a string.");
  });
});
