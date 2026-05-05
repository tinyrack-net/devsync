import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseJsonc,
  resolveJsoncConfigPath,
  stripJsoncComments,
} from "./jsonc.ts";

describe("stripJsoncComments", () => {
  it("passes plain JSON through unchanged", () => {
    const input = `{"key": "value"}`;
    expect(stripJsoncComments(input)).toBe(input);
  });

  it("strips single-line comments", () => {
    const input = `{\n  // a comment\n  "key": "value"\n}`;
    const result = stripJsoncComments(input);
    expect(result).not.toContain("// a comment");
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("strips block comments", () => {
    const input = `{ /* block */ "key": "value" }`;
    const result = stripJsoncComments(input);
    expect(result).not.toContain("block");
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("preserves comment-like text inside string literals", () => {
    const input = `{"url": "https://example.com"}`;
    expect(JSON.parse(stripJsoncComments(input))).toEqual({
      url: "https://example.com",
    });
  });

  it("preserves escape sequences inside strings", () => {
    const input = `{"key": "line1\\nline2"}`;
    expect(JSON.parse(stripJsoncComments(input))).toEqual({
      key: "line1\nline2",
    });
  });

  it("preserves newlines inside block comments for correct error line numbers", () => {
    const input = `{\n/* line1\nline2 */\n"key": "value"\n}`;
    const stripped = stripJsoncComments(input);
    const lines = stripped.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });
});

describe("parseJsonc", () => {
  it("parses plain JSON", () => {
    expect(parseJsonc(`{"a": 1}`)).toEqual({ a: 1 });
  });

  it("parses JSONC with comments", () => {
    const input = `{\n  // comment\n  "a": 1 /* inline */\n}`;
    expect(parseJsonc(input)).toEqual({ a: 1 });
  });

  it("throws SyntaxError for invalid JSON after stripping", () => {
    expect(() => parseJsonc(`{ bad json }`)).toThrow(SyntaxError);
  });
});

describe("resolveJsoncConfigPath", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `jsonc-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the .jsonc path when only .jsonc exists", async () => {
    const jsoncPath = join(dir, "config.jsonc");
    await writeFile(jsoncPath, "{}");
    expect(await resolveJsoncConfigPath(jsoncPath)).toBe(jsoncPath);
  });

  it("rejects .json when only .json exists", async () => {
    const jsoncPath = join(dir, "config.jsonc");
    const jsonPath = join(dir, "config.json");
    await writeFile(jsonPath, "{}");
    await expect(resolveJsoncConfigPath(jsoncPath)).rejects.toThrow(
      /Unsupported dotweave config file/u,
    );
  });

  it("rejects .json when both .jsonc and .json exist", async () => {
    const jsoncPath = join(dir, "config.jsonc");
    const jsonPath = join(dir, "config.json");
    await writeFile(jsoncPath, "{}");
    await writeFile(jsonPath, "{}");
    await expect(resolveJsoncConfigPath(jsoncPath)).rejects.toThrow(
      /Unsupported dotweave config file/u,
    );
  });

  it("returns the preferred path when neither exists", async () => {
    const jsoncPath = join(dir, "config.jsonc");
    expect(await resolveJsoncConfigPath(jsoncPath)).toBe(jsoncPath);
  });
});
