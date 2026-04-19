import { readFile } from "node:fs/promises";

import { z } from "zod";
import { CONSTANTS } from "#app/config/constants.ts";
import { runConfigMigrations } from "#app/config/migration.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { parseJsonc, resolveJsoncConfigPath } from "#app/lib/jsonc.ts";
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

export type GlobalDotweaveConfig = Readonly<{
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

export const parseGlobalDotweaveConfig = (
  input: unknown,
): GlobalDotweaveConfig => {
  const result = globalConfigSchema.safeParse(input);

  if (!result.success) {
    throw new DotweaveError("Global dotweave configuration is invalid.", {
      code: "GLOBAL_CONFIG_VALIDATION_FAILED",
      details: formatInputIssues(result.error.issues).split("\n"),
      hint: "Fix ~/.config/dotweave/settings.jsonc, then run the command again.",
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

export const formatGlobalDotweaveConfig = (config: GlobalDotweaveConfig) => {
  return ensureTrailingNewline(JSON.stringify(config, null, 2));
};

export const readGlobalDotweaveConfig = async (filePath: string) => {
  const resolvedPath = await resolveJsoncConfigPath(filePath);
  try {
    const contents = await readFile(resolvedPath, "utf8");
    const parsed = parseJsonc(contents);
    const migrated = await runConfigMigrations(
      parsed,
      globalConfigMigrationRegistry,
      CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION,
      resolvedPath,
    );

    return parseGlobalDotweaveConfig(migrated);
  } catch (error: unknown) {
    if (error instanceof DotweaveError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new DotweaveError(
        "Global dotweave configuration is not valid JSON.",
        {
          code: "GLOBAL_CONFIG_INVALID_JSON",
          details: [`Config file: ${resolvedPath}`, error.message],
          hint: "Fix the JSON syntax in ~/.config/dotweave/settings.jsonc, then run the command again.",
        },
      );
    }

    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw new DotweaveError("Failed to read global dotweave configuration.", {
      code: "GLOBAL_CONFIG_READ_FAILED",
      details: [
        `Config file: ${resolvedPath}`,
        ...(error instanceof Error ? [error.message] : []),
      ],
    });
  }
};

export const resolveActiveProfileSelection = (
  config: GlobalDotweaveConfig | undefined,
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
