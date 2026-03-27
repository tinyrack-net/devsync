import { describe, expect, it } from "vitest";

import {
  isProfileActive,
  parseGlobalDevsyncConfig,
  resolveActiveProfileSelection,
} from "./global-config.ts";

describe("global config", () => {
  it("normalizes the active profile name", () => {
    expect(
      parseGlobalDevsyncConfig({
        activeProfile: " work ",
        version: 2,
      }),
    ).toEqual({
      activeProfile: "work",
      version: 2,
    });
  });

  it("parses v2 config with age settings (ignores age)", () => {
    expect(
      parseGlobalDevsyncConfig({
        age: {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: ["age1example"],
        },
        version: 2,
      }),
    ).toEqual({
      version: 2,
    });
  });

  it("parses v3 config without age", () => {
    expect(
      parseGlobalDevsyncConfig({
        activeProfile: "work",
        version: 3,
      }),
    ).toEqual({
      activeProfile: "work",
      version: 3,
    });
  });

  it("treats missing config as base-only", () => {
    const selection = resolveActiveProfileSelection(undefined);

    expect(selection).toEqual({
      mode: "none",
    });
    expect(isProfileActive(selection, undefined)).toBe(true);
    expect(isProfileActive(selection, "work")).toBe(false);
  });

  it("uses the configured active profile", () => {
    const selection = resolveActiveProfileSelection({
      activeProfile: "work",
      version: 2,
    });

    expect(selection).toEqual({
      profile: "work",
      mode: "single",
    });
    expect(isProfileActive(selection, undefined)).toBe(true);
    expect(isProfileActive(selection, "work")).toBe(true);
    expect(isProfileActive(selection, "personal")).toBe(false);
  });
});
