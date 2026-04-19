import { describe, expect, it } from "vitest";

import {
  DotweaveError,
  formatDotweaveError,
  wrapUnknownError,
} from "#app/lib/error.ts";

describe("dotweave error helpers", () => {
  it("formats strings and plain errors without extra decoration", () => {
    expect(formatDotweaveError("plain message")).toBe("plain message");
    expect(formatDotweaveError(new Error("broken"))).toBe("broken");
  });

  it("formats DotweaveError details and hints while removing empty lines", () => {
    const error = new DotweaveError("Unable to sync", {
      details: ["first detail", "", "   ", "second detail"],
      hint: "Run dotweave doctor.",
    });

    expect(formatDotweaveError(error)).toBe(
      "Unable to sync\nfirst detail\nsecond detail\nHint: Run dotweave doctor.",
    );
  });

  it("wraps unknown errors while preserving provided metadata", () => {
    const wrapped = wrapUnknownError("Failed to pull", new Error(" timeout "), {
      code: "PULL_FAILED",
      details: ["existing detail"],
      hint: "Try again.",
    });

    expect(wrapped).toBeInstanceOf(DotweaveError);
    expect(wrapped).toMatchObject({
      code: "PULL_FAILED",
      hint: "Try again.",
      message: "Failed to pull",
    });
    expect(wrapped.details).toEqual(["existing detail", "timeout"]);
  });

  it("stringifies non-Error values when wrapping unknown failures", () => {
    const wrapped = wrapUnknownError("Failed to parse", { code: 123 });

    expect(wrapped.details).toEqual(["[object Object]"]);
  });
});
