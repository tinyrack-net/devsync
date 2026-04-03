import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CONSTANTS } from "#app/config/constants.ts";
import { runConfigMigrations } from "#app/config/migration.ts";
import {
  parseSyncConfig,
  type ResolvedSyncConfig,
  type SyncConfigResolutionContext,
} from "#app/config/sync-schema.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { parseJsonc, resolveExistingConfigPath } from "#app/lib/jsonc.ts";

const syncConfigMigrationRegistry = new Map<number, never>();

// ---------------------------------------------------------------------------
// Re-exports: types, schema, entry utilities
// ---------------------------------------------------------------------------

export {
  collectAllProfileNames,
  collectChildEntryPaths,
  findOwningSyncEntry,
  isIgnoredSyncPath,
  isSecretSyncPath,
  resolveEntryRelativeRepoPath,
  resolveManagedSyncMode,
  resolveSyncMode,
  resolveSyncRule,
} from "#app/config/sync-entry.ts";
export type {
  AgeConfig,
  ConfiguredSyncRepoPath,
  PlatformPermission,
  PlatformSyncMode,
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
  SyncConfig,
  SyncConfigEntryKind,
  SyncConfigResolutionContext,
  SyncMode,
} from "#app/config/sync-schema.ts";
export {
  createInitialSyncConfig,
  deriveRepoPathFromLocalPath,
  formatSyncConfig,
  hasReservedSyncArtifactSuffixSegment,
  normalizeSyncProfileName,
  normalizeSyncRepoPath,
  parseSyncConfig,
  validateResolvedSyncConfigEntries,
} from "#app/config/sync-schema.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const syncConfigFileName = CONSTANTS.SYNC.CONFIG_FILE_NAME;

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

export const resolveSyncConfigFilePath = (syncDirectory: string) => {
  return join(syncDirectory, CONSTANTS.SYNC.CONFIG_FILE_NAME);
};

export const readSyncConfig = async (
  syncDirectory: string,
  context: SyncConfigResolutionContext,
): Promise<ResolvedSyncConfig> => {
  const filePath = await resolveExistingConfigPath(
    resolveSyncConfigFilePath(syncDirectory),
  );
  try {
    const contents = await readFile(filePath, "utf8");
    const parsed = parseJsonc(contents);
    const migrated = await runConfigMigrations(
      parsed,
      syncConfigMigrationRegistry,
      CONSTANTS.SYNC.CONFIG_VERSION,
      filePath,
    );

    return parseSyncConfig(migrated, context);
  } catch (error: unknown) {
    if (error instanceof DevsyncError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new DevsyncError("Sync configuration is not valid JSON.", {
        code: "CONFIG_INVALID_JSON",
        details: [`Config file: ${filePath}`, error.message],
        hint: `Fix the JSON syntax in ${CONSTANTS.SYNC.CONFIG_FILE_NAME}, then run the command again.`,
      });
    }

    throw new DevsyncError("Failed to read sync configuration.", {
      code: "CONFIG_READ_FAILED",
      details: [
        `Config file: ${filePath}`,
        ...(error instanceof Error ? [error.message] : []),
      ],
      hint: "Run 'devsync init' if the sync directory has not been initialized yet.",
    });
  }
};
