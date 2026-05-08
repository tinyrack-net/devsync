import { AppConstants } from "#app/config/constants.ts";
import {
  formatGlobalDotweaveConfig,
  readGlobalDotweaveConfig,
} from "#app/config/global-config.ts";
import { collectAllProfileNames } from "#app/config/sync-queries.ts";
import {
  normalizeSyncProfileName,
  readSyncConfig,
} from "#app/config/sync-schema.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { writeTextFileAtomically } from "#app/lib/filesystem.ts";
import { requireGitRepository } from "#app/lib/git.ts";
import {
  buildSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import {
  loadWritableSyncConfig,
  resolveSyncConfigResolutionContext,
  resolveSyncPaths,
} from "./sync-context.ts";
import { resolveTrackedEntry } from "./sync-paths.ts";

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
}>;

export type ProfileUpdateResult = Readonly<{
  activeProfile?: string;
  action: "clear" | "use";
  globalConfigPath: string;
  profile?: string;
  warning?: string;
}>;

type AssignProfilesRequest = Readonly<{
  profiles: readonly string[];
  target: string;
}>;

type AssignProfilesResult = Readonly<{
  action: "assigned" | "unchanged";
  entryRepoPath: string;
  profiles: readonly string[];
}>;

export const listProfiles = async (): Promise<ProfileListResult> => {
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await requireGitRepository(syncDirectory);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDotweaveConfig(globalConfigPath),
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
  };
};

export const setActiveProfile = async (
  profile: string,
): Promise<ProfileUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await requireGitRepository(syncDirectory);

  const syncConfig = await readSyncConfig(syncDirectory, context);
  const knownProfiles = collectAllProfileNames(syncConfig.entries);
  const warning = knownProfiles.includes(normalizedProfile)
    ? undefined
    : `Profile '${normalizedProfile}' is not referenced by any tracked entry.`;

  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDotweaveConfig({
      activeProfile: normalizedProfile,
      version: AppConstants.GLOBAL_CONFIG.CURRENT_VERSION,
    }),
  );

  return {
    activeProfile: normalizedProfile,
    globalConfigPath,
    action: "use",
    profile: normalizedProfile,
    ...(warning !== undefined ? { warning } : {}),
  };
};

export const clearActiveProfile = async (): Promise<ProfileUpdateResult> => {
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();

  await requireGitRepository(syncDirectory);

  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDotweaveConfig({
      version: AppConstants.GLOBAL_CONFIG.CURRENT_VERSION,
    }),
  );

  return {
    globalConfigPath,
    action: "clear",
  };
};

export const assignProfiles = async (
  request: AssignProfilesRequest,
  cwd: string,
): Promise<AssignProfilesResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DotweaveError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked entry path, for example 'dotweave track ~/.gitconfig --profile default --profile work'.",
    });
  }

  const { config, context, syncDirectory } = await loadWritableSyncConfig();
  const entry = resolveTrackedEntry(
    target,
    config.entries,
    cwd,
    context.homeDirectory,
  );

  if (entry === undefined) {
    throw new DotweaveError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'dotweave track'.",
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
      entryRepoPath: entry.repoPath,
      profiles: normalizedProfiles,
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

  await writeValidatedSyncConfig(syncDirectory, nextConfig);

  return {
    action: "assigned",
    entryRepoPath: entry.repoPath,
    profiles: normalizedProfiles,
  };
};
