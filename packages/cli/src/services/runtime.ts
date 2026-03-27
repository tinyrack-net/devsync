import {
  type ActiveProfileSelection,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveActiveProfileSelection,
  resolveConfiguredIdentityFile,
} from "#app/config/global-config.ts";
import {
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncConfigFilePath,
  type SyncAgeConfig,
  syncDefaultProfile,
} from "#app/config/sync.ts";
import {
  resolveDevsyncGlobalConfigFilePath,
  resolveDevsyncSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";

import { DevsyncError } from "./error.ts";
import { ensureGitRepository } from "./git.ts";

export type RuntimeAgeConfig = Readonly<{
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

export type EffectiveSyncConfig = ResolvedSyncConfig &
  Readonly<{
    activeProfile?: string;
    age: RuntimeAgeConfig;
  }>;

export type LoadedSyncConfig = Readonly<{
  effectiveConfig: EffectiveSyncConfig;
  fullConfig: ResolvedSyncConfig;
  globalConfig?: GlobalDevsyncConfig;
}>;

export const resolveSyncPaths = (
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

export const ensureSyncRepository = async (syncDirectory: string) => {
  await ensureGitRepository(syncDirectory);
};

export const resolveAgeFromSyncConfig = (
  age: SyncAgeConfig,
  environment: NodeJS.ProcessEnv,
): RuntimeAgeConfig => {
  return {
    configuredIdentityFile: age.identityFile,
    identityFile: resolveConfiguredIdentityFile(age.identityFile, environment),
    recipients: age.recipients,
  };
};

export const buildEffectiveSyncConfig = (
  fullConfig: ResolvedSyncConfig,
  selection: ActiveProfileSelection,
  age: RuntimeAgeConfig,
): EffectiveSyncConfig => {
  const activeProfile =
    selection.mode === "single" ? selection.profile : undefined;

  const effectiveProfile =
    activeProfile !== undefined && activeProfile !== syncDefaultProfile
      ? activeProfile
      : syncDefaultProfile;

  const entries = fullConfig.entries.filter(
    (entry) =>
      entry.profiles.length === 0 || entry.profiles.includes(effectiveProfile),
  );

  return {
    ...fullConfig,
    entries,
    age,
    ...(activeProfile !== undefined ? { activeProfile } : {}),
  };
};

export const loadSyncConfig = async (
  syncDirectory: string,
  environment: NodeJS.ProcessEnv,
  options: Readonly<{
    profile?: string;
  }> = {},
): Promise<LoadedSyncConfig> => {
  const fullConfig = await readSyncConfig(syncDirectory, environment);
  const globalConfig = await readGlobalDevsyncConfig(environment);
  const selection =
    options.profile === undefined
      ? resolveActiveProfileSelection(globalConfig)
      : {
          profile: options.profile,
          mode: "single" as const,
        };

  const rawAge = fullConfig.age;

  if (rawAge === undefined) {
    const configPath = resolveSyncConfigFilePath(syncDirectory);
    throw new DevsyncError("Age configuration is missing from manifest.json.", {
      code: "AGE_CONFIG_MISSING",
      details: [`Config file: ${configPath}`],
      hint: "Run 'devsync init' to set up encryption.",
    });
  }

  const age = resolveAgeFromSyncConfig(rawAge, environment);

  return {
    effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection, age),
    fullConfig,
    ...(globalConfig === undefined ? {} : { globalConfig }),
  };
};
