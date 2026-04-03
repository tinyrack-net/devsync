import { describe, expect, it } from "vitest";

import { migrateGlobalConfigV2ToV3 } from "./global-v3.ts";

describe("migrateGlobalConfigV2ToV3", () => {
  it("removes the age field and updates version to 3", () => {
    const result = migrateGlobalConfigV2ToV3({
      version: 2,
      activeProfile: "work",
      age: {
        identityFile: "~/.config/devsync/keys.txt",
        recipients: ["age1abc"],
      },
    });

    expect(result).toEqual({ version: 3, activeProfile: "work" });
  });

  it("preserves activeProfile when present", () => {
    const result = migrateGlobalConfigV2ToV3({
      version: 2,
      activeProfile: "personal",
    });

    expect(result).toEqual({ version: 3, activeProfile: "personal" });
  });

  it("works when activeProfile is absent", () => {
    const result = migrateGlobalConfigV2ToV3({ version: 2 });
    expect(result).toEqual({ version: 3 });
  });

  it("removes age even when activeProfile is absent", () => {
    const result = migrateGlobalConfigV2ToV3({
      version: 2,
      age: { recipients: ["age1xyz"] },
    });

    expect(result).toEqual({ version: 3 });
  });
});
