import { CONSTANTS } from "#app/config/constants.ts";
import {
  type ActiveProfileSelection,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveActiveProfileSelection,
} from "#app/config/global-config.ts";
import { resolveConfiguredIdentityFile } from "#app/config/identity-file.ts";
import {
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncConfigFilePath,
  type SyncAgeConfig,
  syncDefaultProfile,
} from "#app/config/sync.ts";
import {
  resolveDevsyncGlobalConfigFilePath,
  resolveDevsyncSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";
import { ENV } from "#app/lib/env.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { ensureGitRepository } from "#app/lib/git.ts";

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

export const resolveSyncPaths = (): SyncPaths => {
  const syncDirectory = resolveDevsyncSyncDirectory(ENV);

  return {
    artifactsDirectory: syncDirectory,
    configPath: resolveSyncConfigFilePath(syncDirectory),
    globalConfigPath: resolveDevsyncGlobalConfigFilePath(ENV),
    homeDirectory: resolveHomeDirectory(ENV),
    syncDirectory,
  };
};

export const ensureSyncRepository = async (syncDirectory: string) => {
  await ensureGitRepository(syncDirectory);
};

export const resolveAgeFromSyncConfig = (
  age: SyncAgeConfig,
): RuntimeAgeConfig => {
  return {
    configuredIdentityFile: age.identityFile,
    identityFile: resolveConfiguredIdentityFile(age.identityFile, ENV),
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
  options: Readonly<{
    profile?: string;
  }> = {},
): Promise<LoadedSyncConfig> => {
  const fullConfig = await readSyncConfig(syncDirectory, ENV);
  const globalConfig = await readGlobalDevsyncConfig(ENV);
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
    throw new DevsyncError(
      `Age configuration is missing from ${CONSTANTS.SYNC.CONFIG_FILE_NAME}.`,
      {
        code: "AGE_CONFIG_MISSING",
        details: [`Config file: ${configPath}`],
        hint: "Run 'devsync init' to set up encryption.",
      },
    );
  }

  const age = resolveAgeFromSyncConfig(rawAge);

  return {
    effectiveConfig: buildEffectiveSyncConfig(fullConfig, selection, age),
    fullConfig,
    ...(globalConfig === undefined ? {} : { globalConfig }),
  };
};
