import { readFile } from "node:fs/promises";

import { z } from "zod";
import { CONSTANTS } from "#app/config/constants.ts";
import { runConfigMigrations } from "#app/config/migration.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { parseJsonc, resolveExistingConfigPath } from "#app/lib/jsonc.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import { formatInputIssues } from "#app/lib/validation.ts";
import { migrateGlobalConfigV2ToV3 } from "#app/migrations/global-v3.ts";
import { normalizeSyncProfileName } from "./sync.ts";

const globalConfigMigrationRegistry = new Map([[2, migrateGlobalConfigV2ToV3]]);

const optionalTrimmedStringSchema = z.string().trim().min(1).optional();

const globalConfigSchema = z.object({
  activeProfile: optionalTrimmedStringSchema,
  version: z.literal(CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION),
});

export type GlobalDevsyncConfig = Readonly<{
  activeProfile?: string;
  version: typeof CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION;
}>;

export type ActiveProfileSelection = Readonly<
  | {
      profile?: undefined;
      mode: "none";
    }
  | {
      profile: string;
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
      hint: "Fix ~/.config/devsync/settings.json, then run the command again.",
    });
  }

  return {
    ...(result.data.activeProfile === undefined
      ? {}
      : {
          activeProfile: normalizeSyncProfileName(result.data.activeProfile),
        }),
    version: result.data.version,
  };
};

export const formatGlobalDevsyncConfig = (config: GlobalDevsyncConfig) => {
  return ensureTrailingNewline(JSON.stringify(config, null, 2));
};

export const readGlobalDevsyncConfig = async (filePath: string) => {
  const resolvedPath = await resolveExistingConfigPath(filePath);
  try {
    const contents = await readFile(resolvedPath, "utf8");
    const parsed = parseJsonc(contents);
    const migrated = await runConfigMigrations(
      parsed,
      globalConfigMigrationRegistry,
      CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION,
      resolvedPath,
    );

    return parseGlobalDevsyncConfig(migrated);
  } catch (error: unknown) {
    if (error instanceof DevsyncError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new DevsyncError(
        "Global devsync configuration is not valid JSON.",
        {
          code: "GLOBAL_CONFIG_INVALID_JSON",
          details: [`Config file: ${resolvedPath}`, error.message],
          hint: "Fix the JSON syntax in ~/.config/devsync/settings.jsonc, then run the command again.",
        },
      );
    }

    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw new DevsyncError("Failed to read global devsync configuration.", {
      code: "GLOBAL_CONFIG_READ_FAILED",
      details: [
        `Config file: ${resolvedPath}`,
        ...(error instanceof Error ? [error.message] : []),
      ],
    });
  }
};

export const resolveActiveProfileSelection = (
  config: GlobalDevsyncConfig | undefined,
): ActiveProfileSelection => {
  if (config?.activeProfile === undefined) {
    return {
      mode: "none",
    };
  }

  return {
    profile: config.activeProfile,
    mode: "single",
  };
};

export const isProfileActive = (
  selection: ActiveProfileSelection,
  profile: string | undefined,
) => {
  if (profile === undefined) {
    return true;
  }

  if (selection.mode === "none") {
    return false;
  }

  return selection.profile === profile;
};
