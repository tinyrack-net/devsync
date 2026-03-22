import {
  type ActiveMachineSelection,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveActiveMachineSelection,
  resolveConfiguredIdentityFile,
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

export type ResolvedAgeConfig = Readonly<{
  configuredIdentityFile: string;
  identityFile: string;
  recipients: readonly string[];
}>;

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
    age: ResolvedAgeConfig;
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

export const resolveAgeFromGlobalConfig = (
  globalConfig: GlobalDevsyncConfig,
  environment: NodeJS.ProcessEnv,
): ResolvedAgeConfig | undefined => {
  if (globalConfig.age === undefined) {
    return undefined;
  }

  return {
    configuredIdentityFile: globalConfig.age.identityFile,
    identityFile: resolveConfiguredIdentityFile(
      globalConfig.age.identityFile,
      environment,
    ),
    recipients: globalConfig.age.recipients,
  };
};

export const buildEffectiveSyncConfig = (
  fullConfig: ResolvedSyncConfig,
  selection: ActiveMachineSelection,
  age: ResolvedAgeConfig,
): EffectiveSyncConfig => {
  return {
    ...fullConfig,
    age,
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

  const age =
    globalConfig !== undefined
      ? resolveAgeFromGlobalConfig(globalConfig, context.environment)
      : undefined;

  if (age === undefined) {
    throw new Error(
      "Age configuration is missing from settings.json. Run 'devsync init' to set up encryption.",
    );
  }

  return {
    effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection, age),
    fullConfig,
    ...(globalConfig === undefined ? {} : { globalConfig }),
  };
};
