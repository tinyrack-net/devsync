import type z from "zod";

export type ZodParserOptions<T> = {
  label?: string;
  schema: z.ZodType<T>;
};

export async function parseWithZod<T>(
  input: string,
  options: ZodParserOptions<T>,
): Promise<T> {
  const result = await options.schema.safeParseAsync(input);

  if (!result.success) {
    throw new Error(formatZodError(result.error, options.label));
  }

  return result.data;
}

function formatZodError(error: z.ZodError, label?: string): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String);
      const issueLabel = label ? [label, ...path].join(".") : path.join(".");

      return issueLabel ? `${issueLabel}: ${issue.message}` : issue.message;
    })
    .join("\n");
}
