import { describe, expect, it } from "bun:test";

import {
  buildDirectoryKey,
  doPathsOverlap,
  isExplicitLocalPath,
  isPathEqualOrNested,
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

  it("recognizes explicit local path inputs", () => {
    expect(isExplicitLocalPath(".")).toBe(true);
    expect(isExplicitLocalPath("~/bundle")).toBe(true);
    expect(isExplicitLocalPath("../bundle")).toBe(true);
    expect(isExplicitLocalPath("bundle/file.txt")).toBe(false);
  });
});
