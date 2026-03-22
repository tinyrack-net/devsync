import { describe, expect, it } from "vitest";

import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "#app/services/paths.ts";

describe("path helpers", () => {
  it("resolves command targets from cwd and home prefixes", () => {
    expect(
      resolveCommandTargetPath("~/bundle", { HOME: "/tmp/home" }, "/tmp/cwd"),
    ).toBe("/tmp/home/bundle");
    expect(
      resolveCommandTargetPath("./bundle", { HOME: "/tmp/home" }, "/tmp/cwd"),
    ).toBe("/tmp/cwd/bundle");
  });

  it("builds repository paths within a root", () => {
    expect(
      buildRepoPathWithinRoot(
        "/tmp/home/.config/tool/settings.json",
        "/tmp/home",
        "Sync target",
      ),
    ).toBe(".config/tool/settings.json");
    expect(buildConfiguredHomeLocalPath(".config/tool/settings.json")).toBe(
      "~/.config/tool/settings.json",
    );
  });

  it("rejects root and out-of-root repository paths", () => {
    expect(() => {
      buildRepoPathWithinRoot("/tmp/home", "/tmp/home", "Sync target");
    }).toThrowError(/root directory/u);
    expect(() => {
      buildRepoPathWithinRoot("/tmp/elsewhere", "/tmp/home", "Sync target");
    }).toThrowError(/must stay inside the configured home root/u);
  });

  it("returns undefined from tolerant helpers for invalid inputs", () => {
    expect(
      tryBuildRepoPathWithinRoot("/tmp/elsewhere", "/tmp/home", "Sync target"),
    ).toBeUndefined();
    expect(tryNormalizeRepoPathInput("../bundle")).toBeUndefined();
  });
});
