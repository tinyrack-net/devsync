import {
  formatGlobalDevsyncConfig,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
} from "#app/config/global-config.ts";

import { normalizeSyncProfileName, readSyncConfig } from "#app/config/sync.ts";

import { writeTextFileAtomically } from "./filesystem.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncProfileListResult = Readonly<{
  activeProfile?: string;
  activeProfilesMode: "none" | "single";
  availableProfiles: readonly string[];
  globalConfigExists: boolean;
  globalConfigPath: string;
  syncDirectory: string;
}>;

export type SyncProfileUpdateResult = Readonly<{
  activeProfile?: string;
  globalConfigPath: string;
  mode: "activate" | "clear" | "deactivate" | "use";
  profile?: string;
  syncDirectory: string;
}>;

const buildProfileList = (
  config: Awaited<ReturnType<typeof readSyncConfig>>,
) => {
  return [
    ...new Set(
      config.entries
        .map((entry) => entry.profile)
        .filter((profile): profile is string => profile !== undefined),
    ),
  ].sort((left, right) => {
    return left.localeCompare(right);
  });
};

const writeGlobalConfig = async (
  configPath: string,
  config: GlobalDevsyncConfig,
) => {
  await writeTextFileAtomically(configPath, formatGlobalDevsyncConfig(config));
};

export const listSyncProfiles = async (
  context: SyncContext,
): Promise<SyncProfileListResult> => {
  await ensureSyncRepository(context);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDevsyncConfig(context.environment),
    readSyncConfig(context.paths.syncDirectory, context.environment),
  ]);

  return {
    ...(globalConfig?.activeProfile === undefined
      ? {}
      : { activeProfile: globalConfig.activeProfile }),
    activeProfilesMode:
      globalConfig?.activeProfile === undefined ? "none" : "single",
    availableProfiles: buildProfileList(syncConfig),
    globalConfigExists: globalConfig !== undefined,
    globalConfigPath: context.paths.globalConfigPath,
    syncDirectory: context.paths.syncDirectory,
  };
};

export const useSyncProfile = async (
  profile: string,
  context: SyncContext,
): Promise<SyncProfileUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);

  await ensureSyncRepository(context);
  await writeGlobalConfig(context.paths.globalConfigPath, {
    activeProfile: normalizedProfile,
    version: 1,
  });

  return {
    activeProfile: normalizedProfile,
    globalConfigPath: context.paths.globalConfigPath,
    mode: "use",
    profile: normalizedProfile,
    syncDirectory: context.paths.syncDirectory,
  };
};

export const clearSyncProfiles = async (
  context: SyncContext,
): Promise<SyncProfileUpdateResult> => {
  await ensureSyncRepository(context);
  await writeGlobalConfig(context.paths.globalConfigPath, {
    version: 1,
  });

  return {
    globalConfigPath: context.paths.globalConfigPath,
    mode: "clear",
    syncDirectory: context.paths.syncDirectory,
  };
};

export const activateSyncProfile = async (
  profile: string,
  context: SyncContext,
): Promise<SyncProfileUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);

  await ensureSyncRepository(context);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDevsyncConfig(context.environment),
    readSyncConfig(context.paths.syncDirectory, context.environment),
  ]);
  buildProfileList(syncConfig);
  const nextProfile = globalConfig?.activeProfile ?? normalizedProfile;

  await writeGlobalConfig(context.paths.globalConfigPath, {
    activeProfile: nextProfile,
    version: 1,
  });

  return {
    activeProfile: nextProfile,
    globalConfigPath: context.paths.globalConfigPath,
    mode: "activate",
    profile: normalizedProfile,
    syncDirectory: context.paths.syncDirectory,
  };
};

export const deactivateSyncProfile = async (
  profile: string,
  context: SyncContext,
): Promise<SyncProfileUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);

  await ensureSyncRepository(context);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDevsyncConfig(context.environment),
    readSyncConfig(context.paths.syncDirectory, context.environment),
  ]);
  buildProfileList(syncConfig);
  const nextProfile =
    globalConfig?.activeProfile === normalizedProfile
      ? undefined
      : globalConfig?.activeProfile;

  await writeGlobalConfig(context.paths.globalConfigPath, {
    ...(nextProfile === undefined ? {} : { activeProfile: nextProfile }),
    version: 1,
  });

  return {
    ...(nextProfile === undefined ? {} : { activeProfile: nextProfile }),
    globalConfigPath: context.paths.globalConfigPath,
    mode: "deactivate",
    profile: normalizedProfile,
    syncDirectory: context.paths.syncDirectory,
  };
};
