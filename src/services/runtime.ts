import {
  type ActiveProfileSelection,
  type GlobalDevsyncConfig,
  isProfileActive,
  readGlobalDevsyncConfig,
  resolveActiveProfileSelection,
} from "#app/config/global-config.ts";
import {
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncConfigFilePath,
  validateResolvedSyncConfigEntries,
} from "#app/config/sync.ts";
import {
  resolveDevsyncGlobalConfigFilePath,
  resolveDevsyncSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";

import { DevsyncError } from "./error.ts";

import { ensureGitRepository } from "./git.ts";

export type SyncPaths = Readonly<{
  artifactsDirectory: string;
  configPath: string;
  globalConfigPath: string;
  homeDirectory: string;
  syncDirectory: string;
}>;

export type SyncContext = Readonly<{
  cwd: string;
  environment: NodeJS.ProcessEnv;
  paths: SyncPaths;
}>;

export type EffectiveSyncConfig = ResolvedSyncConfig &
  Readonly<{
    activeProfile?: string;
    activeProfilesMode: ActiveProfileSelection["mode"];
  }>;

export type LoadedSyncConfig = Readonly<{
  effectiveConfig: EffectiveSyncConfig;
  fullConfig: ResolvedSyncConfig;
  globalConfig?: GlobalDevsyncConfig;
}>;

export const createSyncPaths = (
  environment: NodeJS.ProcessEnv = process.env,
): SyncPaths => {
  const syncDirectory = resolveDevsyncSyncDirectory(environment);

  return {
    artifactsDirectory: resolveSyncArtifactsDirectoryPath(syncDirectory),
    configPath: resolveSyncConfigFilePath(syncDirectory),
    globalConfigPath: resolveDevsyncGlobalConfigFilePath(environment),
    homeDirectory: resolveHomeDirectory(environment),
    syncDirectory,
  };
};

export const createSyncContext = (
  options: Readonly<{
    cwd?: string;
    environment?: NodeJS.ProcessEnv;
  }> = {},
): SyncContext => {
  const environment = options.environment ?? process.env;

  return {
    cwd: options.cwd ?? process.cwd(),
    environment,
    paths: createSyncPaths(environment),
  };
};

export const ensureSyncRepository = async (
  context: Pick<SyncContext, "paths">,
) => {
  await ensureGitRepository(context.paths.syncDirectory);
};

export const buildEffectiveSyncConfig = (
  fullConfig: ResolvedSyncConfig,
  selection: ActiveProfileSelection,
): EffectiveSyncConfig => {
  const groupedEntries = new Map<
    string,
    {
      baseEntry?: ResolvedSyncConfig["entries"][number];
      profileEntry?: ResolvedSyncConfig["entries"][number];
    }
  >();

  for (const entry of fullConfig.entries) {
    if (!isProfileActive(selection, entry.profile)) {
      continue;
    }

    const key = `${entry.kind}\u0000${entry.localPath}\u0000${entry.repoPath}`;
    const group = groupedEntries.get(key) ?? {};

    if (entry.profile === undefined) {
      group.baseEntry = entry;
    } else if (
      selection.mode === "single" &&
      entry.profile === selection.profile
    ) {
      group.profileEntry = entry;
    }

    groupedEntries.set(key, group);
  }

  const entries = [...groupedEntries.values()].flatMap((group) => {
    if (group.profileEntry === undefined) {
      return group.baseEntry === undefined ? [] : [group.baseEntry];
    }

    if (group.baseEntry === undefined) {
      return [group.profileEntry];
    }

    return [
      {
        ...group.baseEntry,
        name: group.profileEntry.name,
        overrides: (() => {
          const mergedOverrides = new Map<
            string,
            (typeof group.baseEntry.overrides)[number]
          >();

          for (const override of group.baseEntry.overrides) {
            const selector =
              override.match === "subtree"
                ? `${override.path}/`
                : override.path;
            mergedOverrides.set(selector, override);
          }

          for (const override of group.profileEntry.overrides) {
            const selector =
              override.match === "subtree"
                ? `${override.path}/`
                : override.path;
            mergedOverrides.set(selector, override);
          }

          return [...mergedOverrides.values()];
        })(),
        profile: group.profileEntry.profile,
      },
    ];
  });

  validateResolvedSyncConfigEntries(entries, {
    allowProfileDisjointOverlaps: false,
  });

  return {
    ...fullConfig,
    activeProfilesMode: selection.mode,
    ...(selection.mode === "single"
      ? { activeProfile: selection.profile }
      : {}),
    entries,
  };
};

export const loadSyncConfig = async (
  context: SyncContext,
): Promise<LoadedSyncConfig> => {
  const fullConfig = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const globalConfig = await readGlobalDevsyncConfig(context.environment);
  const selection = resolveActiveProfileSelection(globalConfig);

  try {
    return {
      effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection),
      fullConfig,
      ...(globalConfig === undefined ? {} : { globalConfig }),
    };
  } catch (error: unknown) {
    if (error instanceof DevsyncError) {
      throw new DevsyncError(
        "Active sync profiles resolve to an invalid configuration.",
        {
          code: "ACTIVE_PROFILE_CONFLICT",
          details: [
            `Global config: ${context.paths.globalConfigPath}`,
            error.message,
          ],
          hint: "Adjust activeProfile or the profile assignments so the active entries no longer overlap.",
        },
      );
    }

    throw error;
  }
};
