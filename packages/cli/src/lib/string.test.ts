import { describe, expect, it } from "vitest";

import {
  ensureTrailingNewline,
  normalizeConfiguredValue,
} from "#app/lib/string.ts";

describe("string helpers", () => {
  it("adds a trailing newline when missing", () => {
    expect(ensureTrailingNewline("value")).toBe("value\n");
  });

  it("preserves an existing trailing newline", () => {
    expect(ensureTrailingNewline("value\n")).toBe("value\n");
  });

  it("normalizeConfiguredValue trims whitespace from a non-empty string", () => {
    expect(normalizeConfiguredValue("  hello  ")).toBe("hello");
  });

  it("normalizeConfiguredValue returns undefined for undefined input", () => {
    expect(normalizeConfiguredValue(undefined)).toBe(undefined);
  });

  it("normalizeConfiguredValue returns undefined for an empty string", () => {
    expect(normalizeConfiguredValue("")).toBe(undefined);
  });

  it("normalizeConfiguredValue returns undefined for a whitespace-only string", () => {
    expect(normalizeConfiguredValue("   ")).toBe(undefined);
  });

  it("normalizeConfiguredValue returns a trimmed string for padded input", () => {
    expect(normalizeConfiguredValue("\tvalue\t")).toBe("value");
  });
});
