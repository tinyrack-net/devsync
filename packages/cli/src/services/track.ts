import { resolve } from "node:path";

import { resolveDefaultIdentityFile } from "#app/config/identity-file.ts";
import type { PlatformStringValue } from "#app/config/platform.ts";
import { readEnvValue } from "#app/config/runtime-env.ts";
import {
  normalizeSyncProfileName,
  normalizeSyncRepoPath,
  type PlatformSyncMode,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";
import { expandHomePath } from "#app/config/xdg.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { getPathStats } from "#app/lib/filesystem.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import { doPathsOverlap } from "#app/lib/path.ts";
import {
  buildSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
} from "./paths.ts";
import {
  resolveSyncConfigResolutionContext,
  resolveSyncPaths,
} from "./runtime.ts";

export type TrackRequest = Readonly<{
  profiles?: readonly string[];
  mode: SyncMode;
  repoPath?: string;
  target: string;
}>;

export type TrackResult = Readonly<{
  alreadyTracked: boolean;
  changed: boolean;
  configPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  mode: SyncMode;
  repoPath: string;
  syncDirectory: string;
}>;

const buildDefaultPlatformMode = (mode: SyncMode): PlatformSyncMode => ({
  default: mode,
});

const hasPlatformSpecificModeOverride = (configuredMode: PlatformSyncMode) => {
  return (
    configuredMode.win !== undefined ||
    configuredMode.mac !== undefined ||
    configuredMode.linux !== undefined ||
    configuredMode.wsl !== undefined
  );
};

const buildDefaultPlatformRepoPath = (
  repoPath: string,
): PlatformStringValue => ({
  default: normalizeSyncRepoPath(repoPath),
});

const buildTrackEntryCandidate = async (
  targetPath: string,
  syncDirectory: string,
  homeDirectory: string,
  input: Readonly<{
    identityFile: string | undefined;
    profiles?: readonly string[];
    mode: SyncMode;
    repoPath?: string;
  }>,
) => {
  const targetStats = await getPathStats(targetPath);

  if (targetStats === undefined) {
    throw new DotweaveError("Sync target does not exist.", {
      code: "TARGET_NOT_FOUND",
      details: [`Target: ${targetPath}`],
      hint: "Create the file or directory first, then run the command again.",
    });
  }

  const kind = (() => {
    if (targetStats.isDirectory()) {
      return "directory" as const;
    }

    if (targetStats.isFile() || targetStats.isSymbolicLink()) {
      return "file" as const;
    }

    throw new DotweaveError("Sync target type is not supported.", {
      code: "TARGET_UNSUPPORTED_TYPE",
      details: [`Target: ${targetPath}`],
      hint: "Track a regular file, symlink, or directory.",
    });
  })();

  if (doPathsOverlap(targetPath, syncDirectory)) {
    throw new DotweaveError("Sync target overlaps the dotweave sync directory.", {
      code: "TARGET_OVERLAPS_SYNC_DIR",
      details: [`Target: ${targetPath}`, `Sync directory: ${syncDirectory}`],
      hint: "Choose a path outside the dotweave sync directory.",
    });
  }

  if (
    input.identityFile !== undefined &&
    doPathsOverlap(targetPath, input.identityFile)
  ) {
    throw new DotweaveError(
      "Sync target contains the configured age identity file.",
      {
        code: "TARGET_OVERLAPS_IDENTITY",
        details: [
          `Target: ${targetPath}`,
          `Age identity file: ${input.identityFile}`,
        ],
        hint: "Store age key material outside tracked sync targets.",
      },
    );
  }

  const localRepoPath = buildRepoPathWithinRoot(
    targetPath,
    homeDirectory,
    "Sync target",
  );
  const configuredLocalPath = buildConfiguredHomeLocalPath(localRepoPath);
  const configuredRepoPath =
    input.repoPath === undefined
      ? undefined
      : buildDefaultPlatformRepoPath(input.repoPath);
  const repoPath = configuredRepoPath?.default ?? localRepoPath;

  return {
    configuredLocalPath,
    ...(configuredRepoPath === undefined ? {} : { configuredRepoPath }),
    kind,
    localPath: targetPath,
    profiles: input.profiles?.map((m) => normalizeSyncProfileName(m)) ?? [],
    profilesExplicit: input.profiles !== undefined,
    mode: input.mode,
    modeExplicit: true,
    configuredMode: buildDefaultPlatformMode(input.mode),
    permissionExplicit: false,
    repoPath,
  } satisfies ResolvedSyncConfigEntry;
};

export const trackTarget = async (
  request: TrackRequest,
  cwd: string,
): Promise<TrackResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DotweaveError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a file or directory path, for example 'dotweave track ~/.gitconfig'.",
    });
  }

  const { syncDirectory, configPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await ensureGitRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, context);
  const identityFile =
    config.age !== undefined
      ? resolveDefaultIdentityFile(
          readEnvValue("HOME"),
          readEnvValue("XDG_CONFIG_HOME"),
        )
      : undefined;
  const isProfileClear =
    request.profiles !== undefined &&
    request.profiles.length === 1 &&
    request.profiles[0] === "";
  const effectiveProfiles = isProfileClear ? [] : request.profiles;

  const candidate = await buildTrackEntryCandidate(
    resolve(cwd, expandHomePath(target, context.homeDirectory)),
    syncDirectory,
    context.homeDirectory,
    {
      identityFile,
      profiles: effectiveProfiles,
      mode: request.mode,
      repoPath: request.repoPath,
    },
  );
  const existingEntry = config.entries.find(
    (entry) => entry.localPath === candidate.localPath,
  );
  const alreadyTracked =
    existingEntry !== undefined && existingEntry.kind === candidate.kind;

  if (existingEntry !== undefined && existingEntry.kind !== candidate.kind) {
    throw new DotweaveError(
      "Sync target conflicts with an existing tracked entry.",
      {
        code: "TARGET_CONFLICT",
        details: [
          `Requested local path: ${candidate.localPath}`,
          `Requested repo path: ${candidate.repoPath}`,
          `Existing entry: ${existingEntry.localPath} -> ${existingEntry.repoPath}`,
        ],
        hint: "Untrack or rename the existing entry before adding this root.",
      },
    );
  }

  const nextEntry =
    existingEntry !== undefined && request.repoPath === undefined
      ? {
          ...candidate,
          configuredRepoPath: existingEntry.configuredRepoPath,
          repoPath: existingEntry.repoPath,
        }
      : candidate;

  const repoPathConflict = config.entries.find((entry) => {
    return (
      entry.repoPath === nextEntry.repoPath &&
      entry.localPath !== nextEntry.localPath
    );
  });

  if (repoPathConflict !== undefined) {
    throw new DotweaveError(
      "Sync target conflicts with an existing tracked entry.",
      {
        code: "TARGET_CONFLICT",
        details: [
          `Requested local path: ${nextEntry.localPath}`,
          `Requested repo path: ${nextEntry.repoPath}`,
          `Existing entry: ${repoPathConflict.localPath} -> ${repoPathConflict.repoPath}`,
        ],
        hint: "Change --repo-path or untrack the conflicting entry first.",
      },
    );
  }

  if (!alreadyTracked) {
    const nextConfig = buildSyncConfigDocument({
      ...config,
      entries: [...config.entries, nextEntry],
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig, context);

    return {
      alreadyTracked,
      changed: true,
      configPath,
      kind: nextEntry.kind,
      localPath: nextEntry.localPath,
      profiles: nextEntry.profiles,
      mode: nextEntry.mode,
      repoPath: nextEntry.repoPath,
      syncDirectory,
    };
  }

  const requestedConfiguredMode = buildDefaultPlatformMode(request.mode);
  const modeChanged =
    existingEntry?.mode !== request.mode ||
    existingEntry?.configuredMode.default !== requestedConfiguredMode.default ||
    (existingEntry !== undefined &&
      hasPlatformSpecificModeOverride(existingEntry.configuredMode));
  const profilesChanged =
    effectiveProfiles !== undefined &&
    (existingEntry?.profiles.length !== candidate.profiles.length ||
      !candidate.profiles.every((m) => existingEntry?.profiles.includes(m)));
  const repoPathChanged =
    request.repoPath !== undefined &&
    (existingEntry?.repoPath !== nextEntry.repoPath ||
      JSON.stringify(existingEntry?.configuredRepoPath) !==
        JSON.stringify(nextEntry.configuredRepoPath));
  const changed = modeChanged || profilesChanged || repoPathChanged;

  if (changed) {
    const nextConfig = buildSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.localPath !== candidate.localPath) {
          return entry;
        }

        return {
          ...entry,
          ...(repoPathChanged
            ? {
                configuredRepoPath: nextEntry.configuredRepoPath,
                repoPath: nextEntry.repoPath,
              }
            : {}),
          ...(modeChanged
            ? {
                configuredMode: requestedConfiguredMode,
                mode: request.mode,
              }
            : {}),
          ...(profilesChanged
            ? {
                profiles: candidate.profiles,
                profilesExplicit: candidate.profilesExplicit,
              }
            : {}),
        };
      }),
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig, context);
  }

  return {
    alreadyTracked,
    changed,
    configPath,
    kind: nextEntry.kind,
    localPath: nextEntry.localPath,
    profiles: profilesChanged
      ? nextEntry.profiles
      : (existingEntry?.profiles ?? []),
    mode: modeChanged ? request.mode : (existingEntry?.mode ?? request.mode),
    repoPath:
      repoPathChanged || !alreadyTracked
        ? nextEntry.repoPath
        : (existingEntry?.repoPath ?? nextEntry.repoPath),
    syncDirectory,
  };
};
