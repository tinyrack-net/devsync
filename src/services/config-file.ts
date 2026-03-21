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

const createSyncOverrideMap = (
  overrides: readonly Pick<ResolvedSyncOverride, "match" | "mode" | "path">[],
) => {
  return Object.fromEntries(
    [...overrides]
      .sort((left, right) => {
        return formatSyncOverrideSelector(left).localeCompare(
          formatSyncOverrideSelector(right),
        );
      })
      .map((override) => {
        return [formatSyncOverrideSelector(override), override.mode];
      }),
  );
};

const createSyncProfileDocument = (
  entry: Pick<ResolvedSyncConfigEntry, "overrides">,
) => {
  return {
    ...(entry.overrides.length === 0
      ? {}
      : { overrides: createSyncOverrideMap(entry.overrides) }),
  };
};

export const createSyncConfigDocumentEntry = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    | "configuredLocalPath"
    | "kind"
    | "mode"
    | "overrides"
    | "profile"
    | "repoPath"
  >,
): SyncConfigDocumentEntry => {
  return {
    kind: entry.kind,
    localPath: entry.configuredLocalPath,
    mode: entry.mode,
    ...(entry.profile === undefined && entry.overrides.length > 0
      ? { overrides: createSyncOverrideMap(entry.overrides) }
      : {}),
    ...(entry.profile === undefined
      ? {}
      : {
          profiles: {
            [entry.profile]: createSyncProfileDocument(entry),
          },
        }),
    repoPath: entry.repoPath,
  };
};

export const sortSyncConfigEntries = (
  entries: readonly SyncConfigDocumentEntry[],
) => {
  return [...entries].sort((left, right) => {
    return left.repoPath.localeCompare(right.repoPath);
  });
};

export const createSyncConfigDocument = (
  config: ResolvedSyncConfig,
): SyncConfig => {
  const groupedEntries = new Map<string, SyncConfigDocumentEntry>();

  for (const entry of config.entries) {
    const key = `${entry.kind}\u0000${entry.configuredLocalPath}\u0000${entry.repoPath}`;
    const existingEntry = groupedEntries.get(key);
    if (existingEntry === undefined) {
      groupedEntries.set(
        key,
        entry.profile === undefined
          ? {
              kind: entry.kind,
              localPath: entry.configuredLocalPath,
              mode: entry.mode,
              ...(entry.overrides.length === 0
                ? {}
                : { overrides: createSyncOverrideMap(entry.overrides) }),
              repoPath: entry.repoPath,
            }
          : {
              kind: entry.kind,
              localPath: entry.configuredLocalPath,
              mode: entry.mode,
              profiles: {
                [entry.profile]: createSyncProfileDocument(entry),
              },
              repoPath: entry.repoPath,
            },
      );
      continue;
    }

    if (entry.profile === undefined) {
      existingEntry.mode = entry.mode;
      if (entry.overrides.length === 0) {
        delete existingEntry.overrides;
      } else {
        existingEntry.overrides = createSyncOverrideMap(entry.overrides);
      }
      continue;
    }

    existingEntry.profiles = {
      ...(existingEntry.profiles ?? {}),
      [entry.profile]: createSyncProfileDocument(entry),
    };
  }

  const entries = sortSyncConfigEntries(
    [...groupedEntries.values()].map((entry) => {
      if (entry.profiles !== undefined && entry.mode !== undefined) {
        entry.profiles = Object.fromEntries(
          Object.entries(entry.profiles).filter(([, profileEntry]) => {
            const profileOverrides = profileEntry.overrides ?? {};

            return Object.keys(profileOverrides).length > 0;
          }),
        );

        if (Object.keys(entry.profiles).length === 0) {
          delete entry.profiles;
        }
      }

      if (entry.profiles === undefined) {
        return entry;
      }

      return {
        ...entry,
        profiles: Object.fromEntries(
          Object.entries(entry.profiles).sort(([left], [right]) => {
            return left.localeCompare(right);
          }),
        ),
      };
    }),
  );

  return {
    version: 1,
    age: {
      identityFile: config.age.configuredIdentityFile,
      recipients: [...config.age.recipients],
    },
    entries,
  };
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
