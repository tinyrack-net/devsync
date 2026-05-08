import { describe, expect, it } from "vitest";
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

  it("formats multiple issues on separate lines", () => {
    const issues = [
      {
        code: "custom",
        message: "Required.",
        path: ["name"],
      },
      {
        code: "custom",
        message: "Invalid format.",
        path: ["email"],
      },
    ] satisfies ZodIssue[];

    expect(formatInputIssues(issues)).toBe(
      "- name: Required.\n- email: Invalid format.",
    );
  });

  it("formats deeply nested paths with 3+ levels", () => {
    const issues = [
      {
        code: "custom",
        message: "Bad mode.",
        path: ["config", "entries", 0, "mode", "default"],
      },
    ] satisfies ZodIssue[];

    expect(formatInputIssues(issues)).toBe(
      "- config.entries.0.mode.default: Bad mode.",
    );
  });

  it("handles numeric path segments correctly", () => {
    const issues = [
      {
        code: "custom",
        message: "Missing.",
        path: ["items", 2, "name"],
      },
    ] satisfies ZodIssue[];

    expect(formatInputIssues(issues)).toBe("- items.2.name: Missing.");
  });

  it("handles special characters in path segments", () => {
    const issues = [
      {
        code: "custom",
        message: "Invalid.",
        path: ["field-with-dashes"],
      },
    ] satisfies ZodIssue[];

    expect(formatInputIssues(issues)).toBe("- field-with-dashes: Invalid.");
  });

  it("formats an empty issues list as empty string", () => {
    expect(formatInputIssues([])).toBe("");
  });
});
