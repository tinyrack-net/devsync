import { CONSTANTS } from "#app/config/constants.ts";
import {
  type ActiveProfileSelection,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveActiveProfileSelection,
} from "#app/config/global-config.ts";
import { resolveDefaultIdentityFile } from "#app/config/identity-file.ts";
import type { PlatformKey } from "#app/config/platform.ts";
import {
  readEnvValue,
  resolveCurrentPlatformKey,
  resolveDevsyncGlobalConfigFilePathFromEnv,
  resolveDevsyncSyncDirectoryFromEnv,
  resolveHomeDirectoryFromEnv,
  resolveXdgConfigHomeFromEnv,
} from "#app/config/runtime-env.ts";
import {
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncConfigFilePath,
  type SyncAgeConfig,
  syncDefaultProfile,
} from "#app/config/sync.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { ensureGitRepository } from "#app/lib/git.ts";

export type RuntimeAgeConfig = Readonly<{
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

export type SyncConfigResolutionContext = Readonly<{
  homeDirectory: string;
  platformKey: PlatformKey;
  xdgConfigHome: string;
}>;

export const resolveSyncConfigResolutionContext =
  (): SyncConfigResolutionContext => {
    return {
      homeDirectory: resolveHomeDirectoryFromEnv(),
      platformKey: resolveCurrentPlatformKey(),
      xdgConfigHome: resolveXdgConfigHomeFromEnv(),
    };
  };

export const resolveSyncPaths = (): SyncPaths => {
  const syncDirectory = resolveDevsyncSyncDirectoryFromEnv();

  return {
    artifactsDirectory: syncDirectory,
    configPath: resolveSyncConfigFilePath(syncDirectory),
    globalConfigPath: resolveDevsyncGlobalConfigFilePathFromEnv(),
    homeDirectory: resolveHomeDirectoryFromEnv(),
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
  const { homeDirectory, platformKey, xdgConfigHome } =
    resolveSyncConfigResolutionContext();
  const fullConfig = await readSyncConfig(
    syncDirectory,
    platformKey,
    homeDirectory,
    xdgConfigHome,
    readEnvValue,
  );
  const globalConfig = await readGlobalDevsyncConfig(
    resolveDevsyncGlobalConfigFilePathFromEnv(),
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
