import { AppConstants } from "#app/config/constants.ts";
import {
  formatGlobalDotweaveConfig,
  isProfileActive,
  readGlobalDotweaveConfig,
  resolveActiveProfileSelection,
} from "#app/config/global-config.ts";
import {
  normalizeSyncProfileName,
  type ResolvedSyncConfig,
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
  activeProfileWarning?: string;
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

export type ProfileRegistryUpdateResult = Readonly<{
  action: "added" | "removed";
  profile: string;
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

const availableProfilesForConfig = (
  config: Pick<ResolvedSyncConfig, "profiles">,
) => [AppConstants.SYNC.DEFAULT_PROFILE, ...(config.profiles ?? [])];

const isKnownProfile = (
  config: Pick<ResolvedSyncConfig, "profiles">,
  profile: string,
) => {
  return availableProfilesForConfig(config).includes(profile);
};

const createUnknownProfileError = (profile: string) =>
  new DotweaveError(`Unknown profile '${profile}'.`, {
    code: "UNKNOWN_PROFILE",
    hint: `Add it with 'dotweave profile add ${profile}', or choose an existing profile.`,
  });

const requireNonDefaultProfile = (profile: string, action: string) => {
  if (profile === AppConstants.SYNC.DEFAULT_PROFILE) {
    throw new DotweaveError(`Cannot ${action} the implicit default profile.`, {
      code: "DEFAULT_PROFILE_IMPLICIT",
      hint: `The '${AppConstants.SYNC.DEFAULT_PROFILE}' profile always exists automatically.`,
    });
  }
};

const normalizeAndRequireKnownProfiles = (
  profiles: readonly string[],
  config: Pick<ResolvedSyncConfig, "profiles">,
) => {
  const normalizedProfiles = profiles.map((profile) =>
    normalizeSyncProfileName(profile),
  );

  for (const profile of normalizedProfiles) {
    if (!isKnownProfile(config, profile)) {
      throw createUnknownProfileError(profile);
    }
  }

  return normalizedProfiles;
};

export const listProfiles = async (): Promise<ProfileListResult> => {
  const { syncDirectory, globalConfigPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await requireGitRepository(syncDirectory);

  const [globalConfig, syncConfig] = await Promise.all([
    readGlobalDotweaveConfig(globalConfigPath),
    readSyncConfig(syncDirectory, context),
  ]);
  const availableProfiles = availableProfilesForConfig(syncConfig);
  const activeProfile =
    globalConfig?.activeProfile ?? AppConstants.SYNC.DEFAULT_PROFILE;
  const activeProfileWarning = !availableProfiles.includes(activeProfile)
    ? `Active profile '${activeProfile}' is not registered in ${AppConstants.SYNC.CONFIG_FILE_NAME}.`
    : undefined;

  return {
    activeProfile,
    ...(activeProfileWarning === undefined ? {} : { activeProfileWarning }),
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
    availableProfiles,
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

  if (!isKnownProfile(syncConfig, normalizedProfile)) {
    throw createUnknownProfileError(normalizedProfile);
  }

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
  };
};

export const addProfile = async (
  profile: string,
): Promise<ProfileRegistryUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);
  requireNonDefaultProfile(normalizedProfile, "add");

  const { config, syncDirectory } = await loadWritableSyncConfig();

  if ((config.profiles ?? []).includes(normalizedProfile)) {
    throw new DotweaveError(`Profile '${normalizedProfile}' already exists.`, {
      code: "PROFILE_ALREADY_EXISTS",
      hint: "Choose a different profile name.",
    });
  }

  const nextConfig = buildSyncConfigDocument({
    ...config,
    profiles: [...(config.profiles ?? []), normalizedProfile].sort(
      (left, right) => left.localeCompare(right),
    ),
  });

  await writeValidatedSyncConfig(syncDirectory, nextConfig);

  return {
    action: "added",
    profile: normalizedProfile,
  };
};

export const removeProfile = async (
  profile: string,
): Promise<ProfileRegistryUpdateResult> => {
  const normalizedProfile = normalizeSyncProfileName(profile);
  requireNonDefaultProfile(normalizedProfile, "remove");

  const { globalConfigPath } = resolveSyncPaths();
  const { config, syncDirectory } = await loadWritableSyncConfig();

  if (!(config.profiles ?? []).includes(normalizedProfile)) {
    throw createUnknownProfileError(normalizedProfile);
  }

  const globalConfig = await readGlobalDotweaveConfig(globalConfigPath);
  const activeProfile = resolveActiveProfileSelection(globalConfig);

  if (isProfileActive(activeProfile, normalizedProfile)) {
    throw new DotweaveError(
      `Cannot remove active profile '${normalizedProfile}'.`,
      {
        code: "PROFILE_ACTIVE",
        hint: "Switch profiles first with 'dotweave profile use default' or clear it with 'dotweave profile use'.",
      },
    );
  }

  const referencingEntries = config.entries.filter((entry) =>
    entry.profiles.includes(normalizedProfile),
  );

  if (referencingEntries.length > 0) {
    const entryCount = referencingEntries.length;
    throw new DotweaveError(
      `Cannot remove profile '${normalizedProfile}' because it is still referenced by ${entryCount} sync ${entryCount === 1 ? "entry" : "entries"}.`,
      {
        code: "PROFILE_IN_USE",
        details: referencingEntries.map((entry) => `Entry: ${entry.repoPath}`),
        hint: "Reassign or clear these entry profile assignments before removing the profile.",
      },
    );
  }

  const nextConfig = buildSyncConfigDocument({
    ...config,
    profiles: (config.profiles ?? []).filter((p) => p !== normalizedProfile),
  });

  await writeValidatedSyncConfig(syncDirectory, nextConfig);

  return {
    action: "removed",
    profile: normalizedProfile,
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

export const validateProfilesExist = async (
  profiles: readonly string[],
): Promise<readonly string[]> => {
  const { config } = await loadWritableSyncConfig();
  return normalizeAndRequireKnownProfiles(profiles, config);
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

  const normalizedProfiles = normalizeAndRequireKnownProfiles(
    request.profiles,
    config,
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
