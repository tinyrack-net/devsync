import { readFile } from "node:fs/promises";

import { z } from "zod";
import { resolveDevsyncGlobalConfigFilePath } from "#app/config/xdg.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import { formatInputIssues } from "#app/lib/validation.ts";
import { DevsyncError } from "#app/services/error.ts";
import { normalizeSyncMachineName } from "./sync.ts";

const optionalTrimmedStringSchema = z.string().trim().min(1).optional();

const globalConfigSchema = z
  .object({
    activeMachine: optionalTrimmedStringSchema,
    version: z.literal(1),
  })
  .strict();

export type GlobalDevsyncConfig = Readonly<{
  activeMachine?: string;
  version: 1;
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

export const parseGlobalDevsyncConfig = (
  input: unknown,
): GlobalDevsyncConfig => {
  const result = globalConfigSchema.safeParse(input);

  if (!result.success) {
    throw new DevsyncError("Global devsync configuration is invalid.", {
      code: "GLOBAL_CONFIG_VALIDATION_FAILED",
      details: formatInputIssues(result.error.issues).split("\n"),
      hint: "Fix ~/.config/devsync/config.json, then run the command again.",
    });
  }

  return {
    ...(result.data.activeMachine === undefined
      ? {}
      : {
          activeMachine: normalizeSyncMachineName(result.data.activeMachine),
        }),
    version: 1,
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
          hint: "Fix the JSON syntax in ~/.config/devsync/config.json, then run the command again.",
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
