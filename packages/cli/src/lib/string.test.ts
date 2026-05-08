import { describe, expect, it } from "vitest";

import { ensureTrailingNewline, trimConfiguredValue } from "#app/lib/string.ts";

describe("string helpers", () => {
  it("adds a trailing newline when missing", () => {
    expect(ensureTrailingNewline("value")).toBe("value\n");
  });

  it("preserves an existing trailing newline", () => {
    expect(ensureTrailingNewline("value\n")).toBe("value\n");
  });

  it("trimConfiguredValue trims whitespace from a non-empty string", () => {
    expect(trimConfiguredValue("  hello  ")).toBe("hello");
  });

  it("trimConfiguredValue returns undefined for undefined input", () => {
    expect(trimConfiguredValue(undefined)).toBe(undefined);
  });

  it("trimConfiguredValue returns undefined for an empty string", () => {
    expect(trimConfiguredValue("")).toBe(undefined);
  });

  it("trimConfiguredValue returns undefined for a whitespace-only string", () => {
    expect(trimConfiguredValue("   ")).toBe(undefined);
  });

  it("trimConfiguredValue returns a trimmed string for padded input", () => {
    expect(trimConfiguredValue("\tvalue\t")).toBe("value");
  });
});
