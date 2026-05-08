export {
  buildDefaultPlatformMode,
  collectAllProfileNames,
  collectChildEntryPaths,
  findOwningSyncEntry,
  hasPlatformSpecificModeOverride,
  isIgnoredSyncPath,
  isSecretSyncPath,
  resolveEntryRelativeRepoPath,
  resolveManagedSyncMode,
  resolveSyncMode,
  resolveSyncRule,
} from "#app/config/sync-entry.ts";

import { CONSTANTS } from "#app/config/constants.ts";

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
  readSyncConfig,
  resolveSyncConfigFilePath,
  syncConfigSchema,
  validateResolvedSyncConfigEntries,
} from "#app/config/sync-schema.ts";

export const syncConfigFileName = CONSTANTS.SYNC.CONFIG_FILE_NAME;
