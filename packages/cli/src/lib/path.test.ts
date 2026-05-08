import { describe, expect, it } from "vitest";

import {
  buildDirectoryKey,
  doPathsOverlap,
  isExplicitLocalPath,
  isPathEqualOrNested,
  normalizeLinkTargetForComparison,
} from "#app/lib/path.ts";

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

  it("handles trailing slashes in doPathsOverlap", () => {
    expect(doPathsOverlap("/tmp/home/", "/tmp/home")).toBe(true);
  });

  it("detects equal paths as overlapping in doPathsOverlap", () => {
    expect(doPathsOverlap("/tmp/home", "/tmp/home")).toBe(true);
  });

  it("isExplicitLocalPath returns false for bare filenames", () => {
    expect(isExplicitLocalPath("filename")).toBe(false);
  });

  it("buildDirectoryKey handles already-trailing-slashed paths", () => {
    expect(buildDirectoryKey("dir/")).toBe("dir//");
  });

  it("isPathEqualOrNested returns true for equal paths", () => {
    expect(isPathEqualOrNested("/tmp/home", "/tmp/home")).toBe(true);
  });

  it("recognizes explicit local path inputs", () => {
    expect(isExplicitLocalPath(".")).toBe(true);
    expect(isExplicitLocalPath("~/bundle")).toBe(true);
    expect(isExplicitLocalPath("../bundle")).toBe(true);
    expect(isExplicitLocalPath("bundle/file.txt")).toBe(false);
  });

  describe("normalizeLinkTargetForComparison", () => {
    it("returns absolute target as-is on non-windows", () => {
      expect(normalizeLinkTargetForComparison("/usr/bin/python3")).toBe(
        "/usr/bin/python3",
      );
    });

    it("resolves relative target against baseDir", () => {
      expect(
        normalizeLinkTargetForComparison("../bin/python3", "/opt/app/venv"),
      ).toBe("/opt/app/bin/python3");
    });

    it("ignores baseDir for absolute target", () => {
      expect(
        normalizeLinkTargetForComparison("/usr/bin/python3", "/opt/app"),
      ).toBe("/usr/bin/python3");
    });

    it("returns target unchanged when no baseDir is given", () => {
      expect(normalizeLinkTargetForComparison("relative/path")).toBe(
        "relative/path",
      );
    });

    it("resolves dot-slash relative target against baseDir", () => {
      expect(
        normalizeLinkTargetForComparison("./script.sh", "/home/user"),
      ).toBe("/home/user/script.sh");
    });
  });
});
