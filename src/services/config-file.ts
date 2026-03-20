import {
  formatSyncConfig,
  formatSyncOverrideSelector,
  parseSyncConfig,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  type ResolvedSyncOverride,
  resolveSyncConfigFilePath,
  type SyncConfig,
} from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";

type SyncConfigDocumentEntry = SyncConfig["entries"][number];

export const sortSyncOverrides = (
  overrides: readonly Pick<ResolvedSyncOverride, "match" | "mode" | "path">[],
) => {
  return [...overrides].sort((left, right) => {
    return formatSyncOverrideSelector(left).localeCompare(
      formatSyncOverrideSelector(right),
    );
  });
};

export const createSyncConfigDocumentEntry = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    "configuredLocalPath" | "kind" | "name" | "mode" | "overrides" | "repoPath"
  >,
): SyncConfigDocumentEntry => {
  return {
    kind: entry.kind,
    localPath: entry.configuredLocalPath,
    mode: entry.mode,
    name: entry.name,
    ...(entry.overrides.length === 0
      ? {}
      : {
          overrides: Object.fromEntries(
            sortSyncOverrides(entry.overrides).map((override) => {
              return [formatSyncOverrideSelector(override), override.mode];
            }),
          ),
        }),
    repoPath: entry.repoPath,
  };
};

export const createSyncConfigDocument = (
  config: ResolvedSyncConfig,
): SyncConfig => {
  return {
    version: 1,
    age: {
      identityFile: config.age.configuredIdentityFile,
      recipients: [...config.age.recipients],
    },
    entries: config.entries.map((entry) => {
      return createSyncConfigDocumentEntry(entry);
    }),
  };
};

export const sortSyncConfigEntries = (
  entries: readonly SyncConfigDocumentEntry[],
) => {
  return [...entries].sort((left, right) => {
    return left.repoPath.localeCompare(right.repoPath);
  });
};

export const countConfiguredRules = (config: ResolvedSyncConfig) => {
  return config.entries.reduce((total, entry) => {
    return total + entry.overrides.length;
  }, 0);
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
