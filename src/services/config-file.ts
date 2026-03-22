import {
  formatSyncConfig,
  formatSyncOverrideSelector,
  parseSyncConfig,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveSyncConfigFilePath,
  type SyncConfig,
} from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";

const createSyncRuleMap = (overrides: ResolvedSyncConfigEntry["overrides"]) => {
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

const createMachinesForFile = (
  machines: ResolvedSyncConfigEntry["machines"],
): string[] | undefined => {
  const list = machines[""];

  if (list === undefined || list.length === 0) {
    return undefined;
  }

  return [...list];
};

const createMachinesForDirectory = (
  machines: ResolvedSyncConfigEntry["machines"],
): Record<string, string[]> | undefined => {
  const entries = Object.entries(machines);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, list]) => [path, [...list]]),
  );
};

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
    config.entries.map((entry): SyncConfig["entries"][number] => {
      if (entry.kind === "file") {
        const machines = createMachinesForFile(entry.machines);

        return {
          kind: "file",
          localPath: entry.configuredLocalPath,
          ...(entry.mode === "normal" ? {} : { mode: entry.mode }),
          ...(machines === undefined ? {} : { machines }),
        };
      }

      const rules =
        entry.overrides.length === 0
          ? undefined
          : createSyncRuleMap(entry.overrides);
      const machines = createMachinesForDirectory(entry.machines);

      return {
        kind: "directory",
        localPath: entry.configuredLocalPath,
        ...(entry.mode === "normal" ? {} : { mode: entry.mode }),
        ...(rules === undefined ? {} : { rules }),
        ...(machines === undefined ? {} : { machines }),
      };
    }),
  );

  return {
    version: 4,
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
