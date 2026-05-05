import { describe, expect, it } from "bun:test";

import { fileContentsEqual } from "#app/lib/content.ts";

const bytes = (value: string | number[]) => {
  if (typeof value !== "string") {
    return Uint8Array.from(value);
  }

  return new TextEncoder().encode(value);
};

const utf8Bom = [0xef, 0xbb, 0xbf];

describe("content helpers", () => {
  it("matches exact bytes", () => {
    expect(fileContentsEqual(bytes("value\n"), bytes("value\n"))).toBe(true);
  });

  it("does not normalize text line endings by default", () => {
    expect(fileContentsEqual(bytes("value\r\n"), bytes("value\n"))).toBe(false);
  });

  it("can treat CRLF and LF as equivalent for UTF-8 text", () => {
    expect(
      fileContentsEqual(bytes("a\r\nb\r\n"), bytes("a\nb\n"), {
        normalizeTextLineEndings: true,
      }),
    ).toBe(true);
  });

  it("normalizes UTF-8 text line endings symmetrically", () => {
    expect(
      fileContentsEqual(bytes("a\nb\n"), bytes("a\r\nb\r\n"), {
        normalizeTextLineEndings: true,
      }),
    ).toBe(true);
  });

  it("treats matching mixed CRLF and LF text as unchanged", () => {
    expect(
      fileContentsEqual(bytes("a\r\nb\nc\r\n"), bytes("a\nb\nc\n"), {
        normalizeTextLineEndings: true,
      }),
    ).toBe(true);
  });

  it("does not normalize lone carriage returns", () => {
    expect(
      fileContentsEqual(bytes("a\rb\n"), bytes("a\nb\n"), {
        normalizeTextLineEndings: true,
      }),
    ).toBe(false);
  });

  it("preserves UTF-8 BOM differences while normalizing line endings", () => {
    expect(
      fileContentsEqual(bytes([...utf8Bom, 0x61, 0x0d, 0x0a]), bytes("a\n"), {
        normalizeTextLineEndings: true,
      }),
    ).toBe(false);
  });

  it("normalizes line endings when both UTF-8 texts have the same BOM", () => {
    expect(
      fileContentsEqual(
        bytes([...utf8Bom, 0x61, 0x0d, 0x0a]),
        bytes([...utf8Bom, 0x61, 0x0a]),
        {
          normalizeTextLineEndings: true,
        },
      ),
    ).toBe(true);
  });

  it("keeps binary-like invalid UTF-8 content byte-strict", () => {
    expect(
      fileContentsEqual(bytes([0xff, 0x0d, 0x0a]), bytes([0xff, 0x0a]), {
        normalizeTextLineEndings: true,
      }),
    ).toBe(false);
  });
});
