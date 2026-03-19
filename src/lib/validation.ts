import { z } from "zod";

export const trimmedOptionalStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    return value === undefined || value === "" ? undefined : value;
  });

export const formatInputIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "input" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
};
