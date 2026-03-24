import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "#app/services/paths.js";

describe("path helpers", () => {
  it("resolves command targets from cwd and home prefixes", () => {
    expect(
      resolveCommandTargetPath("~/bundle", { HOME: "/tmp/home" }, "/tmp/cwd"),
    ).toBe(resolve("/tmp/home", "bundle"));
    expect(
      resolveCommandTargetPath("./bundle", { HOME: "/tmp/home" }, "/tmp/cwd"),
    ).toBe(resolve("/tmp/cwd", "bundle"));
  });

  it("builds repository paths within a root", () => {
    expect(
      buildRepoPathWithinRoot(
        resolve("/tmp/home", ".config/tool/settings.json"),
        resolve("/tmp/home"),
        "Sync target",
      ),
    ).toBe(".config/tool/settings.json");
    expect(buildConfiguredHomeLocalPath(".config/tool/settings.json")).toEqual({
      default: "~/.config/tool/settings.json",
    });
  });

  it("rejects root and out-of-root repository paths", () => {
    expect(() => {
      buildRepoPathWithinRoot(
        resolve("/tmp/home"),
        resolve("/tmp/home"),
        "Sync target",
      );
    }).toThrowError(/root directory/u);
    expect(() => {
      buildRepoPathWithinRoot(
        resolve("/tmp/elsewhere"),
        resolve("/tmp/home"),
        "Sync target",
      );
    }).toThrowError(/must stay inside the configured home root/u);
  });

  it("returns undefined from tolerant helpers for invalid inputs", () => {
    expect(
      tryBuildRepoPathWithinRoot(
        resolve("/tmp/elsewhere"),
        resolve("/tmp/home"),
        "Sync target",
      ),
    ).toBeUndefined();
    expect(tryNormalizeRepoPathInput("../bundle")).toBeUndefined();
  });
});
