import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isProfileActive,
  parseGlobalDotweaveConfig,
  readGlobalDotweaveConfig,
  resolveActiveProfileSelection,
} from "./global-config.ts";

describe("global config", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `global-config-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("normalizes the active profile name", () => {
    expect(
      parseGlobalDotweaveConfig({
        activeProfile: " work ",
        version: 3,
      }),
    ).toEqual({
      activeProfile: "work",
      version: 3,
    });
  });

  it("rejects v2 config (migration happens before parsing)", () => {
    expect(() =>
      parseGlobalDotweaveConfig({
        age: {
          identityFile: "$XDG_CONFIG_HOME/dotweave/keys.txt",
          recipients: ["age1example"],
        },
        version: 2,
      }),
    ).toThrow();
  });

  it("parses v3 config without age", () => {
    expect(
      parseGlobalDotweaveConfig({
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
      version: 3,
    });

    expect(selection).toEqual({
      profile: "work",
      mode: "single",
    });
    expect(isProfileActive(selection, undefined)).toBe(true);
    expect(isProfileActive(selection, "work")).toBe(true);
    expect(isProfileActive(selection, "personal")).toBe(false);
  });

  it("rejects settings.json files", async () => {
    const filePath = join(dir, "settings.jsonc");

    await writeFile(
      join(dir, "settings.json"),
      JSON.stringify({ activeProfile: "work", version: 3 }),
      "utf8",
    );

    await expect(readGlobalDotweaveConfig(filePath)).rejects.toThrow(
      /Unsupported dotweave config file/u,
    );
  });
});
