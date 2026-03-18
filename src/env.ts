import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

const braveSearchApiKeySchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    return value === "" ? undefined : value;
  })
  .pipe(z.string().min(1).optional());

const appEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema.optional(),
    BRAVE_SEARCH_API_KEY: braveSearchApiKeySchema,
  })
  .passthrough();

export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export class EnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

const formatZodIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path =
        issue.path.length === 0 ? "environment" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
};

const resolveNodeEnvironment = (
  environment: NodeJS.ProcessEnv,
  nodeEnvironment?: string,
): string | undefined => {
  if (nodeEnvironment !== undefined) {
    return nodeEnvironment;
  }

  const { NODE_ENV } = environment;

  return NODE_ENV;
};

export const validateEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
  nodeEnvironment?: string,
): AppEnvironment => {
  const resolvedNodeEnvironment = resolveNodeEnvironment(
    environment,
    nodeEnvironment,
  );
  const result = appEnvironmentSchema.safeParse({
    ...environment,
    NODE_ENV: resolvedNodeEnvironment,
  });

  if (!result.success) {
    throw new EnvironmentError(
      `Invalid environment configuration:\n${formatZodIssues(result.error.issues)}`,
    );
  }

  return result.data;
};

export const loadEnvironment = (
  currentWorkingDirectory: string = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
  nodeEnvironment?: string,
): AppEnvironment => {
  const resolvedNodeEnvironment = resolveNodeEnvironment(
    environment,
    nodeEnvironment,
  );

  if (resolvedNodeEnvironment !== "production") {
    const envFilePath = resolve(currentWorkingDirectory, ".env");

    try {
      const parsedEnvironment = dotenv.parse(readFileSync(envFilePath));

      for (const [key, value] of Object.entries(parsedEnvironment)) {
        if (environment[key] === undefined) {
          environment[key] = value;
        }
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return validateEnvironment(environment, resolvedNodeEnvironment);
      }

      throw error;
    }
  }

  return validateEnvironment(environment, resolvedNodeEnvironment);
};
