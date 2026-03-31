import { CONSTANTS } from "#app/config/constants.ts";
import {
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  resolveSyncConfigFilePath,
  type SyncConfig,
} from "#app/config/sync.ts";
import { ENV } from "#app/lib/env.ts";
import { writeTextFileAtomically } from "#app/lib/filesystem.ts";

export const sortSyncConfigEntries = (
  entries: readonly SyncConfig["entries"][number][],
) => {
  return [...entries].sort((left, right) => {
    return left.localPath.default.localeCompare(right.localPath.default);
  });
};

export const createSyncConfigDocument = (
  config: ResolvedSyncConfig,
): SyncConfig => {
  const entries = sortSyncConfigEntries(
    config.entries.map((entry): SyncConfig["entries"][number] => ({
      kind: entry.kind,
      localPath: entry.configuredLocalPath,
      ...(entry.modeExplicit ? { mode: entry.configuredMode } : {}),
      ...(entry.permissionExplicit
        ? { permission: entry.configuredPermission }
        : {}),
      ...(entry.profilesExplicit ? { profiles: [...entry.profiles] } : {}),
    })),
  );

  return {
    version: CONSTANTS.SYNC.CONFIG_VERSION,
    ...(config.age === undefined
      ? {}
      : {
          age: {
            identityFile: config.age.identityFile,
            recipients: [...config.age.recipients],
          },
        }),
    entries,
  } as SyncConfig;
};

export const writeValidatedSyncConfig = async (
  syncDirectory: string,
  config: SyncConfig,
  environment = ENV,
) => {
  const resolvedConfig = parseSyncConfig(config, environment);
  const nextConfig = createSyncConfigDocument(resolvedConfig);

  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};
