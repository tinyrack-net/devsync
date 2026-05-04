import { describe, expect, test } from "vitest";
import {
  bumpVersion,
  formatVersion,
  formatVersionTag,
  parseVersion,
  parseVersionTag,
} from "./version.ts";

describe("version helpers", () => {
  test("parses release tags", () => {
    expect(parseVersionTag("v0.39.22")).toEqual({
      major: 0,
      minor: 39,
      patch: 22,
    });
  });

  test("parses versions", () => {
    expect(parseVersion("0.39.22")).toEqual({
      major: 0,
      minor: 39,
      patch: 22,
    });
  });

  test("bumps versions by release type", () => {
    const version = parseVersionTag("v0.39.22");

    expect(formatVersion(bumpVersion(version, "patch"))).toBe("0.39.23");
    expect(formatVersion(bumpVersion(version, "minor"))).toBe("0.40.0");
    expect(formatVersionTag(bumpVersion(version, "major"))).toBe("v1.0.0");
  });

  test("rejects invalid tags", () => {
    expect(() => parseVersionTag("1.2.3")).toThrow("Invalid release tag");
  });

  test("rejects invalid versions", () => {
    expect(() => parseVersion("v1.2.3")).toThrow("Invalid version");
  });
});
