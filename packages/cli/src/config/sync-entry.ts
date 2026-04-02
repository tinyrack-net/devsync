import { CONSTANTS } from "#app/config/constants.ts";
import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
  SyncMode,
} from "#app/config/sync-schema.ts";
import { DevsyncError } from "#app/lib/error.ts";

// ---------------------------------------------------------------------------
// Entry lookup
// ---------------------------------------------------------------------------

const matchesEntryPath = (
  entry: Pick<ResolvedSyncConfigEntry, "kind" | "repoPath">,
  repoPath: string,
) => {
  return (
    entry.repoPath === repoPath ||
    (entry.kind === "directory" && repoPath.startsWith(`${entry.repoPath}/`))
  );
};

export const findOwningSyncEntry = (
  config: Pick<ResolvedSyncConfig, "entries">,
  repoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  let best: ResolvedSyncConfigEntry | undefined;

  for (const entry of config.entries) {
    if (
      matchesEntryPath(entry, repoPath) &&
      (best === undefined || entry.repoPath.length > best.repoPath.length)
    ) {
      best = entry;
    }
  }

  return best;
};

export const collectChildEntryPaths = (
  config: Pick<ResolvedSyncConfig, "entries">,
  repoPath: string,
): ReadonlySet<string> => {
  return new Set(
    config.entries.flatMap((entry) => {
      return entry.repoPath !== repoPath &&
        entry.repoPath.startsWith(`${repoPath}/`)
        ? [entry.repoPath]
        : [];
    }),
  );
};

export const resolveEntryRelativeRepoPath = (
  entry: Pick<ResolvedSyncConfigEntry, "kind" | "repoPath">,
  repoPath: string,
) => {
  if (entry.kind === "file") {
    return repoPath === entry.repoPath ? "" : undefined;
  }

  if (repoPath === entry.repoPath) {
    return "";
  }

  if (!repoPath.startsWith(`${entry.repoPath}/`)) {
    return undefined;
  }

  return repoPath.slice(entry.repoPath.length + 1);
};

// ---------------------------------------------------------------------------
// Mode / rule resolution
// ---------------------------------------------------------------------------

const resolveProfileForEntry = (
  entry: Pick<ResolvedSyncConfigEntry, "profiles">,
  activeProfile: string | undefined,
): string | undefined => {
  if (entry.profiles.length === 0) {
    return CONSTANTS.SYNC.DEFAULT_PROFILE;
  }

  const effective =
    activeProfile !== undefined &&
    activeProfile !== CONSTANTS.SYNC.DEFAULT_PROFILE
      ? activeProfile
      : CONSTANTS.SYNC.DEFAULT_PROFILE;

  return entry.profiles.includes(effective) ? effective : undefined;
};

export const resolveSyncRule = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeProfile?: string,
): { mode: SyncMode; profile: string } | undefined => {
  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined) {
    return undefined;
  }

  const profile = resolveProfileForEntry(entry, activeProfile);

  if (profile === undefined) {
    return undefined;
  }

  return { mode: entry.mode, profile };
};

export const resolveSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeProfile?: string,
): SyncMode | undefined => {
  return resolveSyncRule(config, repoPath, activeProfile)?.mode;
};

export const isIgnoredSyncPath = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  return resolveSyncMode(config, repoPath) === "ignore";
};

export const isSecretSyncPath = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  return resolveSyncMode(config, repoPath) === "secret";
};

export const resolveManagedSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeProfile?: string,
  context?: string,
) => {
  const mode = resolveSyncMode(config, repoPath, activeProfile);

  if (mode === undefined) {
    throw new DevsyncError(
      "Repository path is not managed by the current sync configuration.",
      {
        code: "UNMANAGED_SYNC_PATH",
        details: [
          `Repository path: ${repoPath}`,
          ...(context === undefined ? [] : [`Context: ${context}`]),
        ],
        hint: "Add the parent path to devsync, or remove stray artifacts from the sync directory.",
      },
    );
  }

  return mode;
};

// ---------------------------------------------------------------------------
// Profile collection
// ---------------------------------------------------------------------------

export const collectAllProfileNames = (
  entries: readonly ResolvedSyncConfigEntry[],
): string[] => {
  const profiles = new Set<string>();

  for (const entry of entries) {
    for (const profile of entry.profiles) {
      profiles.add(profile);
    }
  }

  return [...profiles].sort((left, right) => left.localeCompare(right));
};
