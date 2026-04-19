import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { DotweaveError } from "#app/lib/error.ts";
import { writeTextFileAtomically } from "#app/lib/filesystem.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";

export type ConfigMigrationFn = (
  config: Record<string, unknown>,
) => Record<string, unknown>;

export type ConfigMigrationRegistry = ReadonlyMap<number, ConfigMigrationFn>;

/**
 * Applies sequential config migrations from the detected version up to targetVersion.
 * Creates a backup file before the first migration step, then saves the result.
 * Returns the migrated config (or the original if no migration was needed).
 */
export const runConfigMigrations = async (
  rawConfig: unknown,
  registry: ConfigMigrationRegistry,
  targetVersion: number,
  filePath: string,
): Promise<unknown> => {
  if (
    typeof rawConfig !== "object" ||
    rawConfig === null ||
    Array.isArray(rawConfig)
  ) {
    return rawConfig;
  }

  const configObject = rawConfig as Record<string, unknown>;
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature requires bracket notation
  const version = configObject["version"];

  if (typeof version !== "number") {
    return rawConfig;
  }

  if (version === targetVersion) {
    return rawConfig;
  }

  if (version > targetVersion) {
    throw new DotweaveError(
      `Config file version ${version} is newer than this CLI supports (max: ${targetVersion}).`,
      {
        code: "CONFIG_NEWER_VERSION",
        details: [`Config file: ${filePath}`],
        hint: "Upgrade dotweave to the latest version.",
      },
    );
  }

  const backupPath = join(
    dirname(filePath),
    `${basename(filePath)}.v${version}.bak`,
  );
  await writeFile(
    backupPath,
    ensureTrailingNewline(JSON.stringify(configObject, null, 2)),
    "utf8",
  );

  let current = configObject;

  for (let v = version; v < targetVersion; v++) {
    const migrateFn = registry.get(v);

    if (migrateFn === undefined) {
      throw new DotweaveError(
        `No migration path found for config version ${v} → ${v + 1}.`,
        {
          code: "CONFIG_MIGRATION_NOT_FOUND",
          details: [`Config file: ${filePath}`],
          hint: "Upgrade dotweave to the latest version.",
        },
      );
    }

    try {
      current = migrateFn(current);
    } catch (error: unknown) {
      throw new DotweaveError(
        `Failed to migrate config from version ${v} to ${v + 1}.`,
        {
          code: "CONFIG_MIGRATION_FAILED",
          details: [
            `Config file: ${filePath}`,
            ...(error instanceof Error ? [error.message] : []),
          ],
        },
      );
    }
  }

  await writeTextFileAtomically(
    filePath,
    ensureTrailingNewline(JSON.stringify(current, null, 2)),
  );

  return current;
};
