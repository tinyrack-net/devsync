import { describe, expect, it } from "vitest";

import { buildExecutableMode, isExecutableMode } from "#app/lib/file-mode.ts";

describe("file mode helpers", () => {
  it("builds and detects executable modes", () => {
    expect(buildExecutableMode(true)).toBe(0o755);
    expect(buildExecutableMode(false)).toBe(0o644);
    expect(isExecutableMode(0o100755)).toBe(true);
    expect(isExecutableMode(0o100644)).toBe(false);
  });
});
