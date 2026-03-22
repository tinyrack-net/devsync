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
    version: 6,
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
  environment: NodeJS.ProcessEnv,
) => {
  const resolvedConfig = parseSyncConfig(config, environment);
  const nextConfig = createSyncConfigDocument(resolvedConfig);

  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};
