import { describe, expect, it } from "vitest";

import { DevsyncError } from "#app/services/error.ts";
import {
  buildConfiguredHomeLocalPath,
  buildDirectoryKey,
  buildRepoPathWithinRoot,
  doPathsOverlap,
  isExplicitLocalPath,
  isPathEqualOrNested,
  resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "#app/services/paths.ts";

describe("path helpers", () => {
  it("builds repository directory keys", () => {
    expect(buildDirectoryKey("bundle/cache")).toBe("bundle/cache/");
  });

  it("detects nested and overlapping paths", () => {
    expect(isPathEqualOrNested("/tmp/home/project/file.txt", "/tmp/home")).toBe(
      true,
    );
    expect(isPathEqualOrNested("/tmp/elsewhere", "/tmp/home")).toBe(false);
    expect(doPathsOverlap("/tmp/home/project", "/tmp/home")).toBe(true);
    expect(doPathsOverlap("/tmp/home/one", "/tmp/home/two")).toBe(false);
  });

  it("recognizes explicit local path inputs", () => {
    expect(isExplicitLocalPath(".")).toBe(true);
    expect(isExplicitLocalPath("~/bundle")).toBe(true);
    expect(isExplicitLocalPath("../bundle")).toBe(true);
    expect(isExplicitLocalPath("bundle/file.txt")).toBe(false);
  });

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
    }).toThrowError(DevsyncError);
    expect(() => {
      buildRepoPathWithinRoot("/tmp/elsewhere", "/tmp/home", "Sync target");
    }).toThrowError(DevsyncError);
  });

  it("returns undefined from tolerant helpers for invalid inputs", () => {
    expect(
      tryBuildRepoPathWithinRoot("/tmp/elsewhere", "/tmp/home", "Sync target"),
    ).toBeUndefined();
    expect(tryNormalizeRepoPathInput("../bundle")).toBeUndefined();
  });
});
