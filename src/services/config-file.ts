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
type SyncLayerDocument = NonNullable<SyncConfigDocumentEntry["base"]>;

const createSyncRuleMap = (
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

const createLayerDocument = (input: {
  baseMode?: ResolvedSyncConfigEntry["mode"];
  entry: Pick<ResolvedSyncConfigEntry, "mode" | "overrides">;
}) => {
  const rules =
    input.entry.overrides.length === 0
      ? undefined
      : createSyncRuleMap(input.entry.overrides);

  return {
    ...(input.baseMode === input.entry.mode ? {} : { mode: input.entry.mode }),
    ...(rules === undefined ? {} : { rules }),
  } satisfies SyncLayerDocument;
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
  const groupedEntries = new Map<
    string,
    {
      baseEntry?: ResolvedSyncConfigEntry;
      machineEntries: Map<string, ResolvedSyncConfigEntry>;
    }
  >();

  for (const entry of config.entries) {
    const key = `${entry.kind}\u0000${entry.configuredLocalPath}\u0000${entry.repoPath}`;
    const group = groupedEntries.get(key) ?? {
      machineEntries: new Map<string, ResolvedSyncConfigEntry>(),
    };

    if (entry.machine === undefined) {
      group.baseEntry = entry;
    } else {
      group.machineEntries.set(entry.machine, entry);
    }

    groupedEntries.set(key, group);
  }

  const entries = sortSyncConfigEntries(
    [...groupedEntries.values()].map((group) => {
      const primaryEntry =
        group.baseEntry ?? [...group.machineEntries.values()][0];

      if (primaryEntry === undefined) {
        throw new Error("Grouped sync entries must not be empty.");
      }

      const baseMode = group.baseEntry?.mode;
      const baseRules =
        group.baseEntry === undefined || group.baseEntry.overrides.length === 0
          ? undefined
          : createSyncRuleMap(group.baseEntry.overrides);

      return {
        kind: primaryEntry.kind,
        localPath: primaryEntry.configuredLocalPath,
        repoPath: primaryEntry.repoPath,
        ...(group.baseEntry === undefined
          ? {}
          : {
              base: {
                mode: group.baseEntry.mode,
                ...(baseRules === undefined ? {} : { rules: baseRules }),
              },
            }),
        ...(group.machineEntries.size === 0
          ? {}
          : {
              machines: Object.fromEntries(
                [...group.machineEntries.entries()]
                  .sort(([left], [right]) => {
                    return left.localeCompare(right);
                  })
                  .map(([machine, entry]) => {
                    return [
                      machine,
                      createLayerDocument({
                        baseMode,
                        entry,
                      }),
                    ];
                  }),
              ),
            }),
      } satisfies SyncConfigDocumentEntry;
    }),
  );

  return {
    version: 2,
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
