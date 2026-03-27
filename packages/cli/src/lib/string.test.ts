import { describe, expect, it } from "vitest";

import { ensureTrailingNewline } from "#app/lib/string.js";

describe("string helpers", () => {
  it("adds a trailing newline when missing", () => {
    expect(ensureTrailingNewline("value")).toBe("value\n");
  });

  it("preserves an existing trailing newline", () => {
    expect(ensureTrailingNewline("value\n")).toBe("value\n");
  });
});
