import type { z } from "zod";

/**
 * @description
 * Formats validation issues into CLI-friendly input error messages.
 */
export const formatInputIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "input" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
};
