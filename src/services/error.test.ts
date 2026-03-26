import { describe, expect, it } from "vitest";

import { DevsyncError, formatDevsyncError, wrapUnknownError } from "./error.js";

describe("devsync error helpers", () => {
  it("formats strings and plain errors without extra decoration", () => {
    expect(formatDevsyncError("plain message")).toBe("plain message");
    expect(formatDevsyncError(new Error("broken"))).toBe("broken");
  });

  it("formats DevsyncError details and hints while removing empty lines", () => {
    const error = new DevsyncError("Unable to sync", {
      details: ["first detail", "", "   ", "second detail"],
      hint: "Run devsync doctor.",
    });

    expect(formatDevsyncError(error)).toBe(
      "Unable to sync\nfirst detail\nsecond detail\nHint: Run devsync doctor.",
    );
  });

  it("wraps unknown errors while preserving provided metadata", () => {
    const wrapped = wrapUnknownError("Failed to pull", new Error(" timeout "), {
      code: "PULL_FAILED",
      details: ["existing detail"],
      hint: "Try again.",
    });

    expect(wrapped).toBeInstanceOf(DevsyncError);
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
