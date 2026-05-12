import { beforeEach, describe, expect, test, vi } from "vitest";

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync: mockSpawnSync,
}));

import { captureCommand, isNodeBuiltinSpecifier } from "./pkg.ts";

describe("isNodeBuiltinSpecifier", () => {
  test("returns true for node: prefixed builtins", () => {
    expect(isNodeBuiltinSpecifier("node:fs")).toBe(true);
    expect(isNodeBuiltinSpecifier("node:path")).toBe(true);
  });

  test("returns true for unprefixed builtins", () => {
    expect(isNodeBuiltinSpecifier("fs")).toBe(true);
    expect(isNodeBuiltinSpecifier("path")).toBe(true);
  });

  test("returns false for non-builtin specifiers", () => {
    expect(isNodeBuiltinSpecifier("zod")).toBe(false);
    expect(isNodeBuiltinSpecifier("@stricli/core")).toBe(false);
    expect(isNodeBuiltinSpecifier("./local")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isNodeBuiltinSpecifier("")).toBe(false);
  });
});

describe("captureCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns exitCode, stdout, stderr from successful spawn", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: null,
      stderr: "",
      status: 0,
      stdout: "ok",
    });

    const result = captureCommand("echo", ["hello"]);

    expect(result).toEqual({
      exitCode: 0,
      signal: null,
      stderr: "",
      stdout: "ok",
    });
  });

  test("falls back exitCode to -1 when status is null", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: null,
      stderr: "",
      status: null,
      stdout: "",
    });

    const result = captureCommand("echo", ["hello"]);

    expect(result.exitCode).toBe(-1);
  });

  test("falls back signal to null when undefined", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: undefined,
      stderr: "",
      status: 0,
      stdout: "",
    });

    const result = captureCommand("echo", ["hello"]);

    expect(result.signal).toBe(null);
  });

  test("falls back stderr and stdout to empty string when null", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: null,
      stderr: null,
      status: 0,
      stdout: null,
    });

    const result = captureCommand("echo", ["hello"]);

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("throws when spawnSync returns an error", () => {
    mockSpawnSync.mockReturnValue({
      error: new Error("ENOENT"),
      signal: null,
      stderr: "",
      status: null,
      stdout: "",
    });

    expect(() => captureCommand("missing-cmd", [])).toThrow(/ENOENT/u);
  });

  test("merges provided env with process.env", () => {
    mockSpawnSync.mockReturnValue({
      error: undefined,
      signal: null,
      stderr: "",
      status: 0,
      stdout: "",
    });

    captureCommand("echo", ["hello"], { env: { FOO: "bar" } });

    const callOptions = mockSpawnSync.mock.calls[0]?.[2] as {
      env: Record<string, string> & { FOO: string };
    };

    expect(callOptions.env.FOO).toBe("bar");
  });
});
