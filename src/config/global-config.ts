import { readFile } from "node:fs/promises";

import { z } from "zod";
import {
  resolveConfiguredAbsolutePath,
  resolveDevsyncGlobalConfigFilePath,
} from "#app/config/xdg.js";
import { ensureTrailingNewline } from "#app/lib/string.js";
import { formatInputIssues } from "#app/lib/validation.js";
import { DevsyncError } from "#app/services/error.js";
import { normalizeSyncMachineName } from "./sync.js";

const optionalTrimmedStringSchema = z.string().trim().min(1).optional();

const globalConfigSchemaV2 = z
  .object({
    activeMachine: optionalTrimmedStringSchema,
    age: z.unknown().optional(),
    version: z.literal(2),
  })
  .strict();

const globalConfigSchemaV3 = z
  .object({
    activeMachine: optionalTrimmedStringSchema,
    version: z.literal(3),
  })
  .strict();

const globalConfigSchema = z.union([
  globalConfigSchemaV2,
  globalConfigSchemaV3,
]);

export type GlobalDevsyncConfig = Readonly<{
  activeMachine?: string;
  version: 2 | 3;
}>;

export type ActiveMachineSelection = Readonly<
  | {
      machine?: undefined;
      mode: "none";
    }
  | {
      machine: string;
      mode: "single";
    }
>;

export const resolveConfiguredIdentityFile = (
  value: string,
  environment: NodeJS.ProcessEnv,
) => {
  try {
    return resolveConfiguredAbsolutePath(value, environment);
  } catch (error: unknown) {
    throw new DevsyncError(
      error instanceof Error
        ? error.message
        : `Invalid age identity file path: ${value}`,
    );
  }
};

export const parseGlobalDevsyncConfig = (
  input: unknown,
): GlobalDevsyncConfig => {
  const result = globalConfigSchema.safeParse(input);

  if (!result.success) {
    throw new DevsyncError("Global devsync configuration is invalid.", {
      code: "GLOBAL_CONFIG_VALIDATION_FAILED",
      details: formatInputIssues(result.error.issues).split("\n"),
      hint: "Fix ~/.config/devsync/settings.json, then run the command again.",
    });
  }

  return {
    ...(result.data.activeMachine === undefined
      ? {}
      : {
          activeMachine: normalizeSyncMachineName(result.data.activeMachine),
        }),
    version: result.data.version,
  };
};

export const formatGlobalDevsyncConfig = (config: GlobalDevsyncConfig) => {
  return ensureTrailingNewline(JSON.stringify(config, null, 2));
};

export const readGlobalDevsyncConfig = async (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const filePath = resolveDevsyncGlobalConfigFilePath(environment);

  try {
    const contents = await readFile(filePath, "utf8");

    return parseGlobalDevsyncConfig(JSON.parse(contents) as unknown);
  } catch (error: unknown) {
    if (error instanceof DevsyncError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new DevsyncError(
        "Global devsync configuration is not valid JSON.",
        {
          code: "GLOBAL_CONFIG_INVALID_JSON",
          details: [`Config file: ${filePath}`, error.message],
          hint: "Fix the JSON syntax in ~/.config/devsync/settings.json, then run the command again.",
        },
      );
    }

    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw new DevsyncError("Failed to read global devsync configuration.", {
      code: "GLOBAL_CONFIG_READ_FAILED",
      details: [
        `Config file: ${filePath}`,
        ...(error instanceof Error ? [error.message] : []),
      ],
    });
  }
};

export const resolveActiveMachineSelection = (
  config: GlobalDevsyncConfig | undefined,
): ActiveMachineSelection => {
  if (config?.activeMachine === undefined) {
    return {
      mode: "none",
    };
  }

  return {
    machine: config.activeMachine,
    mode: "single",
  };
};

export const isMachineActive = (
  selection: ActiveMachineSelection,
  machine: string | undefined,
) => {
  if (machine === undefined) {
    return true;
  }

  if (selection.mode === "none") {
    return false;
  }

  return selection.machine === machine;
};
