import {
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveSyncConfigFilePath,
  type SyncConfig,
  type SyncConfigEntryKind,
} from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";

type SyncConfigDocumentEntry = SyncConfig["entries"][number];

export const createSyncConfigDocumentEntry = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    | "configuredLocalPath"
    | "ignoreGlobs"
    | "kind"
    | "name"
    | "repoPath"
    | "secretGlobs"
  >,
): SyncConfigDocumentEntry => {
  return {
    ...(entry.ignoreGlobs.length === 0
      ? {}
      : {
          ignoreGlobs: sortSyncGlobs(entry.ignoreGlobs),
        }),
    kind: entry.kind,
    localPath: entry.configuredLocalPath,
    name: entry.name,
    repoPath: entry.repoPath,
    ...(entry.secretGlobs.length === 0
      ? {}
      : {
          secretGlobs: sortSyncGlobs(entry.secretGlobs),
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
    ignoreGlobs: [...config.ignoreGlobs],
    secretGlobs: [...config.secretGlobs],
  };
};

export const sortSyncConfigEntries = (
  entries: readonly SyncConfigDocumentEntry[],
) => {
  return [...entries].sort((left, right) => {
    return left.repoPath.localeCompare(right.repoPath);
  });
};

export const sortSyncGlobs = (globs: readonly string[]) => {
  return [...globs].sort((left, right) => {
    return left.localeCompare(right);
  });
};

export const buildEntryCanonicalSecretGlob = (entry: {
  kind: SyncConfigEntryKind;
}) => {
  return entry.kind === "directory" ? "**" : "*";
};

export const buildLegacyGlobalCanonicalSecretGlob = (entry: {
  kind: SyncConfigEntryKind;
  repoPath: string;
}) => {
  return entry.kind === "directory" ? `${entry.repoPath}/**` : entry.repoPath;
};

export const addCanonicalEntrySecretGlob = (entry: SyncConfigDocumentEntry) => {
  const entrySecretGlobs = entry.secretGlobs ?? [];
  const canonicalSecretGlob = buildEntryCanonicalSecretGlob(entry);

  if (entrySecretGlobs.includes(canonicalSecretGlob)) {
    return {
      added: false,
      entry: createSyncConfigDocumentEntry({
        configuredLocalPath: entry.localPath,
        ignoreGlobs: entry.ignoreGlobs ?? [],
        kind: entry.kind,
        name: entry.name,
        repoPath: entry.repoPath,
        secretGlobs: entrySecretGlobs,
      }),
    };
  }

  return {
    added: true,
    entry: createSyncConfigDocumentEntry({
      configuredLocalPath: entry.localPath,
      ignoreGlobs: entry.ignoreGlobs ?? [],
      kind: entry.kind,
      name: entry.name,
      repoPath: entry.repoPath,
      secretGlobs: [...entrySecretGlobs, canonicalSecretGlob],
    }),
  };
};

export const removeLegacyGlobalCanonicalSecretGlob = (
  secretGlobs: readonly string[],
  entry: {
    kind: SyncConfigEntryKind;
    repoPath: string;
  },
) => {
  const canonicalSecretGlob = buildLegacyGlobalCanonicalSecretGlob(entry);
  const nextSecretGlobs = secretGlobs.filter((glob) => {
    return glob !== canonicalSecretGlob;
  });

  return {
    removed: nextSecretGlobs.length !== secretGlobs.length,
    secretGlobs: sortSyncGlobs(nextSecretGlobs),
  };
};

export const countConfiguredSecretGlobs = (config: ResolvedSyncConfig) => {
  return (
    config.secretGlobs.length +
    config.entries.reduce((total, entry) => {
      return total + entry.secretGlobs.length;
    }, 0)
  );
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
          ignoreGlobs: entry.ignoreGlobs ?? [],
          kind: entry.kind,
          name: entry.name,
          repoPath: entry.repoPath,
          secretGlobs: entry.secretGlobs ?? [],
        });
      }),
    ),
    ignoreGlobs: sortSyncGlobs(config.ignoreGlobs),
    secretGlobs: sortSyncGlobs(config.secretGlobs),
  } satisfies SyncConfig;

  parseSyncConfig(nextConfig, environment);
  await writeTextFileAtomically(
    resolveSyncConfigFilePath(syncDirectory),
    formatSyncConfig(nextConfig),
  );

  return nextConfig;
};
