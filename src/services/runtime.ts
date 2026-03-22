import {
  type ActiveMachineSelection,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveActiveMachineSelection,
  resolveConfiguredIdentityFile,
} from "#app/config/global-config.ts";
import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigAge,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncConfigFilePath,
  syncDefaultMachine,
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

export const resolveAgeFromSyncConfig = (
  age: ResolvedSyncConfigAge,
  environment: NodeJS.ProcessEnv,
): ResolvedAgeConfig => {
  return {
    configuredIdentityFile: age.identityFile,
    identityFile: resolveConfiguredIdentityFile(age.identityFile, environment),
    recipients: age.recipients,
  };
};

export const buildEffectiveSyncConfig = (
  fullConfig: ResolvedSyncConfig,
  selection: ActiveMachineSelection,
  age: ResolvedAgeConfig,
): EffectiveSyncConfig => {
  const activeMachine =
    selection.mode === "single" ? selection.machine : undefined;

  const effectiveMachine =
    activeMachine !== undefined && activeMachine !== syncDefaultMachine
      ? activeMachine
      : syncDefaultMachine;

  const entries = fullConfig.entries.filter(
    (entry) =>
      entry.machines.length === 0 || entry.machines.includes(effectiveMachine),
  );

  return {
    ...fullConfig,
    entries,
    age,
    ...(activeMachine !== undefined ? { activeMachine } : {}),
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

  const rawAge = fullConfig.age;

  if (rawAge === undefined) {
    throw new Error(
      "Age configuration is missing from manifest.json. Run 'devsync init' to set up encryption.",
    );
  }

  const age = resolveAgeFromSyncConfig(rawAge, context.environment);

  return {
    effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection, age),
    fullConfig,
    ...(globalConfig === undefined ? {} : { globalConfig }),
  };
};
