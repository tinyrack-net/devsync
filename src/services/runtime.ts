import {
  type ActiveMachineSelection,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveActiveMachineSelection,
} from "#app/config/global-config.ts";
import {
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncConfigFilePath,
} from "#app/config/sync.ts";
import {
  resolveDevsyncGlobalConfigFilePath,
  resolveDevsyncSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";

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
  return {
    ...fullConfig,
    ...(selection.mode === "single"
      ? { activeMachine: selection.machine }
      : {}),
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

  return {
    effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection),
    fullConfig,
    ...(globalConfig === undefined ? {} : { globalConfig }),
  };
};
