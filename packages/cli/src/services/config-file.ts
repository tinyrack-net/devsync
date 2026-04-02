import { CONSTANTS } from "#app/config/constants.ts";
import type { PlatformKey } from "#app/config/platform.ts";
import {
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  resolveSyncConfigFilePath,
  type SyncConfig,
} from "#app/config/sync.ts";
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
      ...(entry.configuredRepoPath === undefined
        ? {}
        : { repoPath: entry.configuredRepoPath }),
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
            recipients: [...config.age.recipients],
          },
        }),
    entries,
  } as SyncConfig;
};

export const writeValidatedSyncConfig = async (
  syncDirectory: string,
  config: SyncConfig,
  platformKey: PlatformKey,
  homeDirectory: string,
  xdgConfigHome: string,
  readEnv: (name: string) => string | undefined,
) => {
  const resolvedConfig = parseSyncConfig(
    config,
    platformKey,
    homeDirectory,
    xdgConfigHome,
    readEnv,
  );
  const nextConfig = createSyncConfigDocument(resolvedConfig);

  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};
