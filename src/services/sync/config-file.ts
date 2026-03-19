import {
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  type ResolvedSyncConfigRule,
  resolveSyncConfigFilePath,
  type SyncConfig,
} from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";

type SyncConfigDocumentEntry = SyncConfig["entries"][number];

const compareRuleMatches = (
  left: ResolvedSyncConfigRule["match"],
  right: ResolvedSyncConfigRule["match"],
) => {
  if (left === right) {
    return 0;
  }

  return left === "exact" ? -1 : 1;
};

export const sortSyncRules = (
  rules: readonly Pick<ResolvedSyncConfigRule, "match" | "mode" | "path">[],
) => {
  return [...rules].sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);

    if (pathComparison !== 0) {
      return pathComparison;
    }

    const matchComparison = compareRuleMatches(left.match, right.match);

    if (matchComparison !== 0) {
      return matchComparison;
    }

    return left.mode.localeCompare(right.mode);
  });
};

export const createSyncConfigDocumentEntry = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    | "configuredLocalPath"
    | "defaultMode"
    | "kind"
    | "name"
    | "repoPath"
    | "rules"
  >,
): SyncConfigDocumentEntry => {
  return {
    ...(entry.defaultMode === "normal"
      ? {}
      : {
          defaultMode: entry.defaultMode,
        }),
    kind: entry.kind,
    localPath: entry.configuredLocalPath,
    name: entry.name,
    repoPath: entry.repoPath,
    ...(entry.rules.length === 0
      ? {}
      : {
          rules: sortSyncRules(entry.rules).map((rule) => {
            return {
              match: rule.match,
              mode: rule.mode,
              path: rule.path,
            };
          }),
        }),
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
    return total + entry.rules.length;
  }, 0);
};

export const writeValidatedSyncConfig = async (
  syncDirectory: string,
  config: SyncConfig,
  environment: NodeJS.ProcessEnv,
) => {
  const nextConfig = {
    ...config,
    entries: sortSyncConfigEntries(
      config.entries.map((entry) => {
        return createSyncConfigDocumentEntry({
          configuredLocalPath: entry.localPath,
          defaultMode: entry.defaultMode ?? "normal",
          kind: entry.kind,
          name: entry.name,
          repoPath: entry.repoPath,
          rules: entry.rules ?? [],
        });
      }),
    ),
  } satisfies SyncConfig;

  parseSyncConfig(nextConfig, environment);
  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};
