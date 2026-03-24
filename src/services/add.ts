import { resolveConfiguredIdentityFile } from "#app/config/global-config.js";
import {
  normalizeSyncProfileName,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.js";
import { doPathsOverlap } from "#app/lib/path.js";
import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.js";
import { DevsyncError } from "./error.js";
import { getPathStats } from "./filesystem.js";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  resolveCommandTargetPath,
} from "./paths.js";
import { ensureSyncRepository, resolveSyncPaths } from "./runtime.js";

export type SyncAddRequest = Readonly<{
  profiles?: readonly string[];
  mode: SyncMode;
  target: string;
}>;

export type SyncAddResult = Readonly<{
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

const buildAddEntryCandidate = async (
  targetPath: string,
  syncDirectory: string,
  homeDirectory: string,
  input: Readonly<{
    identityFile: string | undefined;
    profiles?: readonly string[];
    mode: SyncMode;
  }>,
) => {
  const targetStats = await getPathStats(targetPath);

  if (targetStats === undefined) {
    throw new DevsyncError("Sync target does not exist.", {
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

    throw new DevsyncError("Sync target type is not supported.", {
      code: "TARGET_UNSUPPORTED_TYPE",
      details: [`Target: ${targetPath}`],
      hint: "Track a regular file, symlink, or directory.",
    });
  })();

  if (doPathsOverlap(targetPath, syncDirectory)) {
    throw new DevsyncError("Sync target overlaps the devsync repository.", {
      code: "TARGET_OVERLAPS_SYNC_DIR",
      details: [`Target: ${targetPath}`, `Sync directory: ${syncDirectory}`],
      hint: "Choose a path outside the devsync sync directory.",
    });
  }

  if (
    input.identityFile !== undefined &&
    doPathsOverlap(targetPath, input.identityFile)
  ) {
    throw new DevsyncError(
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

  const repoPath = buildRepoPathWithinRoot(
    targetPath,
    homeDirectory,
    "Sync target",
  );
  const configuredLocalPath = buildConfiguredHomeLocalPath(repoPath);

  return {
    configuredLocalPath,
    kind,
    localPath: targetPath,
    profiles: input.profiles?.map((m) => normalizeSyncProfileName(m)) ?? [],
    profilesExplicit: input.profiles !== undefined,
    mode: input.mode,
    modeExplicit: true,
    repoPath,
  } satisfies ResolvedSyncConfigEntry;
};

export const trackSyncTarget = async (
  request: SyncAddRequest,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Promise<SyncAddResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a file or directory path, for example 'devsync track ~/.gitconfig'.",
    });
  }

  const { syncDirectory, configPath, homeDirectory } =
    resolveSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, environment);
  const identityFile =
    config.age !== undefined
      ? resolveConfiguredIdentityFile(config.age.identityFile, environment)
      : undefined;
  const isProfileClear =
    request.profiles !== undefined &&
    request.profiles.length === 1 &&
    request.profiles[0] === "";
  const effectiveProfiles = isProfileClear ? [] : request.profiles;

  const candidate = await buildAddEntryCandidate(
    resolveCommandTargetPath(target, environment, cwd),
    syncDirectory,
    homeDirectory,
    {
      identityFile,
      profiles: effectiveProfiles,
      mode: request.mode,
    },
  );
  const existingEntry = config.entries.find((entry) => {
    return (
      entry.localPath === candidate.localPath &&
      entry.repoPath === candidate.repoPath
    );
  });
  const alreadyTracked =
    existingEntry !== undefined && existingEntry.kind === candidate.kind;

  if (existingEntry !== undefined && existingEntry.kind !== candidate.kind) {
    throw new DevsyncError(
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

  if (!alreadyTracked) {
    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: [...config.entries, candidate],
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig, environment);

    return {
      alreadyTracked,
      changed: true,
      configPath,
      kind: candidate.kind,
      localPath: candidate.localPath,
      profiles: candidate.profiles,
      mode: candidate.mode,
      repoPath: candidate.repoPath,
      syncDirectory,
    };
  }

  const modeChanged = existingEntry?.mode !== request.mode;
  const profilesChanged =
    effectiveProfiles !== undefined &&
    (existingEntry?.profiles.length !== candidate.profiles.length ||
      !candidate.profiles.every((m) => existingEntry?.profiles.includes(m)));
  const changed = modeChanged || profilesChanged;

  if (changed) {
    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== candidate.repoPath) {
          return entry;
        }

        return {
          ...entry,
          ...(modeChanged ? { mode: request.mode } : {}),
          ...(profilesChanged
            ? {
                profiles: candidate.profiles,
                profilesExplicit: candidate.profilesExplicit,
              }
            : {}),
        };
      }),
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig, environment);
  }

  return {
    alreadyTracked,
    changed,
    configPath,
    kind: candidate.kind,
    localPath: candidate.localPath,
    profiles: profilesChanged
      ? candidate.profiles
      : (existingEntry?.profiles ?? []),
    mode: modeChanged ? request.mode : (existingEntry?.mode ?? request.mode),
    repoPath: candidate.repoPath,
    syncDirectory,
  };
};
