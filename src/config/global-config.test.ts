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
        version: 2,
      }),
    ).toEqual({
      activeMachine: "work",
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
        activeMachine: "work",
        version: 3,
      }),
    ).toEqual({
      activeMachine: "work",
      version: 3,
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
      version: 2,
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
