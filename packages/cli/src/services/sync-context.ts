import { AppConstants } from "#app/config/constants.ts";
import {
  type ActiveProfileSelection,
  type GlobalDotweaveConfig,
  readGlobalDotweaveConfig,
  resolveActiveProfileSelection,
} from "#app/config/global-config.ts";
import { resolveDefaultIdentityFile } from "#app/config/identity-file.ts";
import {
  readEnvValue,
  resolveCurrentPlatformKey,
  resolveDotweaveGlobalConfigFilePathFromEnv,
  resolveDotweaveSyncDirectoryFromEnv,
  resolveHomeDirectoryFromEnv,
  resolveXdgConfigHomeFromEnv,
} from "#app/config/runtime-env.ts";
import {
  type AgeConfig,
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncConfigFilePath,
  type SyncConfigResolutionContext,
} from "#app/config/sync-schema.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { requireGitRepository } from "#app/lib/git.ts";

export type RuntimeAgeConfig = Readonly<{
  identityFile: string;
  recipients: readonly string[];
}>;

export type SyncPaths = Readonly<{
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
  globalConfig?: GlobalDotweaveConfig;
}>;

export const resolveSyncConfigResolutionContext =
  (): SyncConfigResolutionContext => {
    return {
      homeDirectory: resolveHomeDirectoryFromEnv(),
      platformKey: resolveCurrentPlatformKey(),
      readEnv: readEnvValue,
      xdgConfigHome: resolveXdgConfigHomeFromEnv(),
    };
  };

export const resolveSyncPaths = (): SyncPaths => {
  const syncDirectory = resolveDotweaveSyncDirectoryFromEnv();

  return {
    configPath: resolveSyncConfigFilePath(syncDirectory),
    globalConfigPath: resolveDotweaveGlobalConfigFilePathFromEnv(),
    homeDirectory: resolveHomeDirectoryFromEnv(),
    syncDirectory,
  };
};

export const resolveAgeFromSyncConfig = (age: AgeConfig): RuntimeAgeConfig => {
  return {
    identityFile: resolveDefaultIdentityFile(
      readEnvValue("HOME"),
      readEnvValue("XDG_CONFIG_HOME"),
    ),
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
    activeProfile !== undefined &&
    activeProfile !== AppConstants.SYNC.DEFAULT_PROFILE
      ? activeProfile
      : AppConstants.SYNC.DEFAULT_PROFILE;

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
  const context = resolveSyncConfigResolutionContext();
  const fullConfig = await readSyncConfig(syncDirectory, context);
  const globalConfig = await readGlobalDotweaveConfig(
    resolveDotweaveGlobalConfigFilePathFromEnv(),
  );
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
    throw new DotweaveError(
      `Age configuration is missing from ${AppConstants.SYNC.CONFIG_FILE_NAME}.`,
      {
        code: "AGE_CONFIG_MISSING",
        details: [`Config file: ${configPath}`],
        hint: "Run 'dotweave init' to set up encryption.",
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

export type WritableSyncConfig = Readonly<{
  config: ResolvedSyncConfig;
  configPath: string;
  context: SyncConfigResolutionContext;
  syncDirectory: string;
}>;

export const loadWritableSyncConfig = async (): Promise<WritableSyncConfig> => {
  const { syncDirectory, configPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();
  await requireGitRepository(syncDirectory);
  const config = await readSyncConfig(syncDirectory, context);
  return { config, configPath, context, syncDirectory };
};
