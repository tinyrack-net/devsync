import { describe, expect, it } from "vitest";

import {
  buildExecutableMode,
  formatPermissionOctal,
  isExecutableMode,
  isPermissionOctal,
  parsePermissionOctal,
} from "#app/lib/file-mode.js";

describe("file mode helpers", () => {
  it("builds and detects executable modes", () => {
    expect(buildExecutableMode(true)).toBe(0o755);
    expect(buildExecutableMode(false)).toBe(0o644);
    expect(isExecutableMode(0o100755)).toBe(true);
    expect(isExecutableMode(0o100644)).toBe(false);
  });
});

describe("permission octal helpers", () => {
  it("validates permission octal strings", () => {
    expect(isPermissionOctal("0600")).toBe(true);
    expect(isPermissionOctal("0755")).toBe(true);
    expect(isPermissionOctal("0644")).toBe(true);
    expect(isPermissionOctal("0000")).toBe(true);
    expect(isPermissionOctal("0777")).toBe(true);

    expect(isPermissionOctal("600")).toBe(false);
    expect(isPermissionOctal("0800")).toBe(false);
    expect(isPermissionOctal("07755")).toBe(false);
    expect(isPermissionOctal("")).toBe(false);
    expect(isPermissionOctal("abcd")).toBe(false);
    expect(isPermissionOctal("0x1FF")).toBe(false);
  });

  it("parses valid permission octal strings", () => {
    expect(parsePermissionOctal("0600")).toBe(0o600);
    expect(parsePermissionOctal("0755")).toBe(0o755);
    expect(parsePermissionOctal("0644")).toBe(0o644);
    expect(parsePermissionOctal("0000")).toBe(0o000);
    expect(parsePermissionOctal("0777")).toBe(0o777);
    expect(parsePermissionOctal("0400")).toBe(0o400);
  });

  it("throws on invalid permission octal strings", () => {
    expect(() => parsePermissionOctal("600")).toThrow(
      "Invalid permission octal",
    );
    expect(() => parsePermissionOctal("0800")).toThrow(
      "Invalid permission octal",
    );
    expect(() => parsePermissionOctal("")).toThrow("Invalid permission octal");
  });

  it("formats permission modes to octal strings", () => {
    expect(formatPermissionOctal(0o600)).toBe("0600");
    expect(formatPermissionOctal(0o755)).toBe("0755");
    expect(formatPermissionOctal(0o644)).toBe("0644");
    expect(formatPermissionOctal(0o000)).toBe("0000");
    expect(formatPermissionOctal(0o777)).toBe("0777");
    expect(formatPermissionOctal(0o400)).toBe("0400");
  });

  it("masks higher bits when formatting", () => {
    expect(formatPermissionOctal(0o100644)).toBe("0644");
    expect(formatPermissionOctal(0o100755)).toBe("0755");
  });
});
