import {
  type ActiveMachineSelection,
  type GlobalDevsyncConfig,
  isMachineActive,
  readGlobalDevsyncConfig,
  resolveActiveMachineSelection,
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
    activeMachine?: string;
    activeMachinesMode: ActiveMachineSelection["mode"];
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
  selection: ActiveMachineSelection,
): EffectiveSyncConfig => {
  const groupedEntries = new Map<
    string,
    {
      baseEntry?: ResolvedSyncConfig["entries"][number];
      machineEntry?: ResolvedSyncConfig["entries"][number];
    }
  >();

  for (const entry of fullConfig.entries) {
    if (!isMachineActive(selection, entry.machine)) {
      continue;
    }

    const key = `${entry.kind}\u0000${entry.localPath}\u0000${entry.repoPath}`;
    const group = groupedEntries.get(key) ?? {};

    if (entry.machine === undefined) {
      group.baseEntry = entry;
    } else if (
      selection.mode === "single" &&
      entry.machine === selection.machine
    ) {
      group.machineEntry = entry;
    }

    groupedEntries.set(key, group);
  }

  const entries = [...groupedEntries.values()].flatMap((group) => {
    if (group.machineEntry === undefined) {
      return group.baseEntry === undefined ? [] : [group.baseEntry];
    }

    if (group.baseEntry === undefined) {
      return [group.machineEntry];
    }

    return [
      {
        ...group.baseEntry,
        ...(group.machineEntry.modeExplicit
          ? {
              machine: group.machineEntry.machine,
              mode: group.machineEntry.mode,
              modeExplicit: true,
              name: group.machineEntry.name,
            }
          : {}),
        machineLayer: group.machineEntry.machine,
        machineMode: group.machineEntry.mode,
        machineModeExplicit: group.machineEntry.modeExplicit,
        machineOverrides: group.machineEntry.overrides,
      },
    ];
  });

  validateResolvedSyncConfigEntries(entries, {
    allowMachineDisjointOverlaps: false,
  });

  return {
    ...fullConfig,
    activeMachinesMode: selection.mode,
    ...(selection.mode === "single"
      ? { activeMachine: selection.machine }
      : {}),
    entries,
  };
};

export const loadSyncConfig = async (
  context: SyncContext,
  options: Readonly<{
    machine?: string;
  }> = {},
): Promise<LoadedSyncConfig> => {
  const fullConfig = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const globalConfig = await readGlobalDevsyncConfig(context.environment);
  const selection =
    options.machine === undefined
      ? resolveActiveMachineSelection(globalConfig)
      : {
          machine: options.machine,
          mode: "single" as const,
        };

  try {
    return {
      effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection),
      fullConfig,
      ...(globalConfig === undefined ? {} : { globalConfig }),
    };
  } catch (error: unknown) {
    if (error instanceof DevsyncError) {
      throw new DevsyncError(
        "Active sync machines resolve to an invalid configuration.",
        {
          code: "ACTIVE_MACHINE_CONFLICT",
          details: [
            `Global config: ${context.paths.globalConfigPath}`,
            error.message,
          ],
          hint: "Adjust activeMachine or the machine assignments so the active entries no longer overlap.",
        },
      );
    }

    throw error;
  }
};
