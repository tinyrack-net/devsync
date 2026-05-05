import { describe, expect, it } from "bun:test";
import type { ZodIssue } from "zod";

import { formatInputIssues } from "#app/lib/validation.ts";

describe("validation helpers", () => {
  it("formats root-level issues as input", () => {
    const issues = [
      {
        code: "custom",
        message: "Invalid request.",
        path: [],
      },
    ] satisfies ZodIssue[];

    expect(formatInputIssues(issues)).toBe("- input: Invalid request.");
  });

  it("formats nested issue paths with dot notation", () => {
    const issues = [
      {
        code: "custom",
        message: "Value must not be empty.",
        path: ["entries", 0, "repoPath"],
      },
    ] satisfies ZodIssue[];

    expect(formatInputIssues(issues)).toBe(
      "- entries.0.repoPath: Value must not be empty.",
    );
  });
});
