import {
  formatGlobalDevsyncConfig,
  readGlobalDevsyncConfig,
} from "#app/config/global-config.js";
import {
  collectAllProfileNames,
  normalizeSyncProfileName,
  readSyncConfig,
} from "#app/config/sync.js";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.js";
import { DevsyncError } from "./error.js";
import { writeTextFileAtomically } from "./filesystem.js";
import { resolveTrackedEntry } from "./paths.js";
import { createSyncPaths, ensureSyncRepository } from "./runtime.js";

export type SyncProfileAssignment = Readonly<{
  entryLocalPath: string;
  entryRepoPath: string;
  profiles: readonly string[];
}>;

export type SyncProfileListResult = Readonly<{
  activeProfile?: string;
  activeProfilesMode: "none" | "single";
  assignments: readonly SyncProfileAssignment[];
  availableProfiles: readonly string[];
  globalConfigExists: boolean;
  globalConfigPath: string;
  syncDirectory: string;
}>;

export type SyncProfileUpdateResult = Readonly<{
  activeProfile?: string;
  globalConfigPath: string;
  mode: "clear" | "use";
  profile?: string;
  syncDirectory: string;
  warning?: string;
}>;

type SyncProfileAssignRequest = Readonly<{
  profiles: readonly string[];
  target: string;
}>;

type SyncProfileAssignResult = Readonly<{
  action: "assigned" | "unchanged";
  configPath: string;
  entryRepoPath: string;
  profiles: readonly string[];
  syncDirectory: string;
}>;

export const listSyncProfiles = async (
  environment: NodeJS.ProcessEnv,
): Promise<SyncProfileListResult> => {
  const { syncDirectory, globalConfigPath } = createSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDevsyncConfig(environment),
    readSyncConfig(syncDirectory, environment),
  ]);

  return {
    ...(globalConfig?.activeProfile === undefined
      ? {}
      : { activeProfile: globalConfig.activeProfile }),
    activeProfilesMode:
      globalConfig?.activeProfile === undefined ? "none" : "single",
    assignments: syncConfig.entries
      .filter((entry) => entry.profilesExplicit && entry.profiles.length > 0)
      .map((entry) => ({
        entryLocalPath: entry.localPath,
        entryRepoPath: entry.repoPath,
        profiles: entry.profiles,
      }))
      .sort((left, right) =>
        left.entryRepoPath.localeCompare(right.entryRepoPath),
      ),
    availableProfiles: collectAllProfileNames(syncConfig.entries),
    globalConfigExists: globalConfig !== undefined,
    globalConfigPath,
    syncDirectory,
  };
};

export const useSyncProfile = async (
  profile: string,
  environment: NodeJS.ProcessEnv,
): Promise<SyncProfileUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);
  const { syncDirectory, globalConfigPath } = createSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  const syncConfig = await readSyncConfig(syncDirectory, environment);
  const knownProfiles = collectAllProfileNames(syncConfig.entries);
  const warning = knownProfiles.includes(normalizedProfile)
    ? undefined
    : `Profile '${normalizedProfile}' is not referenced by any tracked entry.`;

  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDevsyncConfig({
      activeProfile: normalizedProfile,
      version: 3,
    }),
  );

  return {
    activeProfile: normalizedProfile,
    globalConfigPath,
    mode: "use",
    profile: normalizedProfile,
    syncDirectory,
    ...(warning !== undefined ? { warning } : {}),
  };
};

export const clearSyncProfiles = async (
  environment: NodeJS.ProcessEnv,
): Promise<SyncProfileUpdateResult> => {
  const { syncDirectory, globalConfigPath } = createSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDevsyncConfig({ version: 3 }),
  );

  return {
    globalConfigPath,
    mode: "clear",
    syncDirectory,
  };
};

export const assignSyncProfiles = async (
  request: SyncProfileAssignRequest,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Promise<SyncProfileAssignResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked entry path, for example 'devsync track ~/.gitconfig --profile default --profile work'.",
    });
  }

  const { syncDirectory, configPath } = createSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, environment);
  const entry = resolveTrackedEntry(target, config.entries, environment, cwd);

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'devsync track'.",
    });
  }

  const normalizedProfiles = request.profiles.map((m) =>
    normalizeSyncProfileName(m),
  );

  if (
    entry.profiles.length === normalizedProfiles.length &&
    normalizedProfiles.every((m) => entry.profiles.includes(m))
  ) {
    return {
      action: "unchanged",
      configPath,
      entryRepoPath: entry.repoPath,
      profiles: normalizedProfiles,
      syncDirectory,
    };
  }

  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((e) => {
      if (e.repoPath !== entry.repoPath) {
        return e;
      }

      return {
        ...e,
        profiles: normalizedProfiles,
        profilesExplicit: normalizedProfiles.length > 0,
      };
    }),
  });

  await writeValidatedSyncConfig(syncDirectory, nextConfig, environment);

  return {
    action: "assigned",
    configPath,
    entryRepoPath: entry.repoPath,
    profiles: normalizedProfiles,
    syncDirectory,
  };
};
