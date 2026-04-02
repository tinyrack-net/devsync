import { CONSTANTS } from "#app/config/constants.ts";
import {
  formatGlobalDevsyncConfig,
  readGlobalDevsyncConfig,
} from "#app/config/global-config.ts";
import {
  collectAllProfileNames,
  normalizeSyncProfileName,
  readSyncConfig,
} from "#app/config/sync.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { writeTextFileAtomically } from "#app/lib/filesystem.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import {
  buildSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { resolveTrackedEntry } from "./paths.ts";
import {
  resolveSyncConfigResolutionContext,
  resolveSyncPaths,
} from "./runtime.ts";

export type ProfileAssignment = Readonly<{
  entryLocalPath: string;
  entryRepoPath: string;
  profiles: readonly string[];
}>;

export type ProfileListResult = Readonly<{
  activeProfile?: string;
  activeProfileMode: "none" | "single";
  assignments: readonly ProfileAssignment[];
  availableProfiles: readonly string[];
  globalConfigExists: boolean;
  globalConfigPath: string;
  syncDirectory: string;
}>;

export type ProfileUpdateResult = Readonly<{
  activeProfile?: string;
  action: "clear" | "use";
  globalConfigPath: string;
  profile?: string;
  syncDirectory: string;
  warning?: string;
}>;

type AssignProfilesRequest = Readonly<{
  profiles: readonly string[];
  target: string;
}>;

type AssignProfilesResult = Readonly<{
  action: "assigned" | "unchanged";
  configPath: string;
  entryRepoPath: string;
  profiles: readonly string[];
  syncDirectory: string;
}>;

export const listProfiles = async (): Promise<ProfileListResult> => {
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await ensureGitRepository(syncDirectory);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDevsyncConfig(globalConfigPath),
    readSyncConfig(syncDirectory, context),
  ]);

  return {
    ...(globalConfig?.activeProfile === undefined
      ? {}
      : { activeProfile: globalConfig.activeProfile }),
    activeProfileMode:
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

export const setActiveProfile = async (
  profile: string,
): Promise<ProfileUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await ensureGitRepository(syncDirectory);

  const syncConfig = await readSyncConfig(syncDirectory, context);
  const knownProfiles = collectAllProfileNames(syncConfig.entries);
  const warning = knownProfiles.includes(normalizedProfile)
    ? undefined
    : `Profile '${normalizedProfile}' is not referenced by any tracked entry.`;

  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDevsyncConfig({
      activeProfile: normalizedProfile,
      version: CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION,
    }),
  );

  return {
    activeProfile: normalizedProfile,
    globalConfigPath,
    action: "use",
    profile: normalizedProfile,
    syncDirectory,
    ...(warning !== undefined ? { warning } : {}),
  };
};

export const clearActiveProfile = async (): Promise<ProfileUpdateResult> => {
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();

  await ensureGitRepository(syncDirectory);

  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDevsyncConfig({
      version: CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION,
    }),
  );

  return {
    globalConfigPath,
    action: "clear",
    syncDirectory,
  };
};

export const assignProfiles = async (
  request: AssignProfilesRequest,
  cwd: string,
): Promise<AssignProfilesResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked entry path, for example 'devsync track ~/.gitconfig --profile default --profile work'.",
    });
  }

  const { syncDirectory, configPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await ensureGitRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, context);
  const entry = resolveTrackedEntry(
    target,
    config.entries,
    cwd,
    context.homeDirectory,
  );

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

  const nextConfig = buildSyncConfigDocument({
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

  await writeValidatedSyncConfig(syncDirectory, nextConfig, context);

  return {
    action: "assigned",
    configPath,
    entryRepoPath: entry.repoPath,
    profiles: normalizedProfiles,
    syncDirectory,
  };
};
