import { describe, expect, it } from "vitest";

import {
  isMachineActive,
  parseGlobalDevsyncConfig,
  resolveActiveMachineSelection,
} from "./global-config.ts";

describe("global config", () => {
  it("normalizes the active machine name", () => {
    expect(
      parseGlobalDevsyncConfig({
        activeMachine: " work ",
        version: 1,
      }),
    ).toEqual({
      activeMachine: "work",
      version: 1,
    });
  });

  it("treats missing config as base-only", () => {
    const selection = resolveActiveMachineSelection(undefined);

    expect(selection).toEqual({
      mode: "none",
    });
    expect(isMachineActive(selection, undefined)).toBe(true);
    expect(isMachineActive(selection, "work")).toBe(false);
  });

  it("uses the configured active machine", () => {
    const selection = resolveActiveMachineSelection({
      activeMachine: "work",
      version: 1,
    });

    expect(selection).toEqual({
      machine: "work",
      mode: "single",
    });
    expect(isMachineActive(selection, undefined)).toBe(true);
    expect(isMachineActive(selection, "work")).toBe(true);
    expect(isMachineActive(selection, "personal")).toBe(false);
  });
});
