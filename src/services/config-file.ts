import {
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  resolveSyncConfigFilePath,
  type SyncConfig,
} from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";

export const sortSyncConfigEntries = (
  entries: readonly SyncConfig["entries"][number][],
) => {
  return [...entries].sort((left, right) => {
    return left.localPath.localeCompare(right.localPath);
  });
};

export const createSyncConfigDocument = (
  config: ResolvedSyncConfig,
): SyncConfig => {
  const entries = sortSyncConfigEntries(
    config.entries.map((entry): SyncConfig["entries"][number] => ({
      kind: entry.kind,
      localPath: entry.configuredLocalPath,
      ...(entry.mode === "normal" ? {} : { mode: entry.mode }),
      ...(entry.machines.length === 0 ? {} : { machines: [...entry.machines] }),
    })),
  );

  return {
    version: 5,
    entries,
  };
};

export const writeValidatedSyncConfig = async (
  syncDirectory: string,
  config: SyncConfig,
  dependencies: Readonly<{
    environment: NodeJS.ProcessEnv;
  }>,
) => {
  const resolvedConfig = parseSyncConfig(
    {
      ...config,
      entries: sortSyncConfigEntries(config.entries),
    },
    dependencies.environment,
  );
  const nextConfig = createSyncConfigDocument(resolvedConfig);

  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};
