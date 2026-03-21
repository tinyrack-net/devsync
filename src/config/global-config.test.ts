import { describe, expect, it } from "vitest";

import {
  isProfileActive,
  parseGlobalDevsyncConfig,
  resolveActiveProfileSelection,
} from "#app/config/global-config.ts";

describe("global devsync config", () => {
  it("normalizes active profile lists", () => {
    expect(
      parseGlobalDevsyncConfig({
        activeProfile: " work ",
        version: 1,
      }),
    ).toEqual({
      activeProfile: "work",
      version: 1,
    });
  });

  it("treats missing config as profiled entries disabled", () => {
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
      version: 1,
    });

    expect(selection).toEqual({
      mode: "single",
      profile: "work",
    });
    expect(isProfileActive(selection, undefined)).toBe(true);
    expect(isProfileActive(selection, "work")).toBe(true);
  });
});
