import { join } from "node:path";

import {
  findOwningSyncEntry,
  normalizeSyncProfileName,
  type ResolvedSyncConfigEntry,
  type ResolvedSyncOverride,
  readSyncConfig,
  resolveEntryRelativeRepoPath,
  resolveRelativeSyncRule,
  type SyncMode,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import { getPathStats } from "./filesystem.ts";
import {
  buildRepoPathWithinRoot,
  isExplicitLocalPath,
  resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncSetRequest = Readonly<{
  profile?: string;
  recursive: boolean;
  state: SyncMode;
  target: string;
}>;

type SyncSetScope = "default" | "exact" | "subtree";
type SyncSetAction = "added" | "removed" | "unchanged" | "updated";
type SyncSetReason =
  | "already-inherited"
  | "already-set"
  | "already-set-on-entry"
  | "reverted-to-inherited";

export type SyncSetResult = Readonly<{
  action: SyncSetAction;
  configPath: string;
  entryRepoPath: string;
  localPath: string;
  mode: SyncMode;
  profile?: string;
  repoPath: string;
  reason?: SyncSetReason;
  scope: SyncSetScope;
  syncDirectory: string;
}>;

const resolveTargetPath = async (
  target: string,
  entry: ResolvedSyncConfigEntry,
  context: Pick<SyncContext, "cwd" | "environment" | "paths">,
) => {
  if (isExplicitLocalPath(target)) {
    const localPath = resolveCommandTargetPath(
      target,
      context.environment,
      context.cwd,
    );
    const stats = await getPathStats(localPath);

    if (stats === undefined) {
      throw new DevsyncError("Sync set target does not exist.", {
        code: "TARGET_NOT_FOUND",
        details: [`Target: ${localPath}`],
        hint: "Use an existing local path, or pass a repository path inside a tracked directory.",
      });
    }

    return {
      localPath,
      repoPath: buildRepoPathWithinRoot(
        localPath,
        context.paths.homeDirectory,
        "Sync set target",
      ),
      stats,
    };
  }

  const repoPath = tryNormalizeRepoPathInput(target);

  if (repoPath === undefined) {
    throw new DevsyncError(
      "Sync set target is not a valid local or repository path.",
      {
        code: "INVALID_SET_TARGET",
        details: [`Target: ${target}`],
        hint: "Use an absolute path, a cwd-relative path, or a repository path like '.config/tool/file.json'.",
      },
    );
  }

  const relativePath = resolveEntryRelativeRepoPath(entry, repoPath);
  const localPath =
    relativePath === undefined || relativePath === ""
      ? entry.localPath
      : join(entry.localPath, ...relativePath.split("/"));

  return {
    localPath,
    repoPath,
    stats: await getPathStats(localPath),
  };
};

const resolveSetTarget = async (
  target: string,
  profile: string | undefined,
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  context: Pick<SyncContext, "cwd" | "environment" | "paths">,
) => {
  const matchingEntries = config.entries
    .filter((entry) => {
      return profile === undefined
        ? true
        : entry.profile === profile || entry.profile === undefined;
    })
    .sort((left, right) => {
      if (profile === undefined || left.profile === right.profile) {
        return 0;
      }

      if (left.profile === profile) {
        return -1;
      }

      if (right.profile === profile) {
        return 1;
      }

      return 0;
    });
  const trimmedTarget = target.trim();

  if (trimmedTarget.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a local path or repository path after the mode, for example 'devsync set secret ~/.ssh/id_ed25519'.",
    });
  }

  const homeDirectory = context.paths.homeDirectory;
  const explicitLocalPath = isExplicitLocalPath(trimmedTarget);
  const localTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    context.environment,
    context.cwd,
  );
  const localRepoPath = explicitLocalPath
    ? buildRepoPathWithinRoot(localTargetPath, homeDirectory, "Sync set target")
    : tryBuildRepoPathWithinRoot(
        localTargetPath,
        homeDirectory,
        "Sync set target",
      );

  if (localRepoPath !== undefined) {
    const localStats = await getPathStats(localTargetPath);

    if (explicitLocalPath && localStats === undefined) {
      throw new DevsyncError("Sync set target does not exist.", {
        code: "TARGET_NOT_FOUND",
        details: [`Target: ${localTargetPath}`],
        hint: "Use an existing local path, or pass a repository path inside a tracked directory.",
      });
    }

    const entry = findOwningSyncEntry(
      { entries: matchingEntries },
      localRepoPath,
    );
    const ambiguousEntries =
      profile === undefined
        ? config.entries.filter((candidate) => {
            return (
              resolveEntryRelativeRepoPath(candidate, localRepoPath) !==
              undefined
            );
          })
        : [];

    if (
      explicitLocalPath &&
      entry !== undefined &&
      entry.kind === "file" &&
      entry.localPath === localTargetPath
    ) {
      if (profile !== undefined) {
        throw new DevsyncError(
          "Profile-specific root updates are not supported for file entries.",
          {
            code: "FILE_ENTRY_SET_UNSUPPORTED",
            details: [`Target: ${trimmedTarget}`, `Profile: ${profile}`],
            hint: "Track the file once without a profile, or move it under a tracked directory and use profile-specific child overrides instead.",
          },
        );
      }

      if (entry.profile !== undefined) {
        throw new DevsyncError(
          "Tracked file entries cannot be updated with 'devsync set'.",
          {
            code: "FILE_ENTRY_SET_UNSUPPORTED",
            details: [`Target: ${trimmedTarget}`],
            hint: "Use 'devsync add --secret' when first tracking a file, or forget and re-add it with the desired mode.",
          },
        );
      }

      return {
        entry,
        localPath: localTargetPath,
        relativePath: "",
        repoPath: localRepoPath,
        stats: localStats,
      };
    }

    if (entry?.kind === "directory") {
      const relativePath = resolveEntryRelativeRepoPath(entry, localRepoPath);

      if (relativePath !== undefined) {
        return {
          entry,
          localPath: localTargetPath,
          relativePath,
          repoPath: localRepoPath,
          stats: localStats,
        };
      }
    }

    if (
      profile === undefined &&
      entry === undefined &&
      ambiguousEntries.length > 1
    ) {
      throw new DevsyncError(
        "Sync set target matches multiple profiled entries.",
        {
          code: "TARGET_CONFLICT",
          details: [`Target: ${trimmedTarget}`],
          hint: "Pass --profile to choose which tracked profile entry to update.",
        },
      );
    }

    if (explicitLocalPath) {
      throw new DevsyncError(
        "Local set target is not inside a tracked directory entry.",
        {
          code: "TARGET_NOT_TRACKED",
          details: [`Target: ${trimmedTarget}`],
          hint: "Add the parent directory with 'devsync add' first, then apply nested rules with 'devsync set'.",
        },
      );
    }
  }

  const repoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (repoPath === undefined) {
    throw new DevsyncError(
      "Sync set target is not a valid local or repository path.",
      {
        code: "INVALID_SET_TARGET",
        details: [`Target: ${trimmedTarget}`],
        hint: "Use an absolute path, a cwd-relative path, or a repository path like '.config/tool/file.json'.",
      },
    );
  }

  const entry = findOwningSyncEntry({ entries: matchingEntries }, repoPath);
  const ambiguousEntries =
    profile === undefined
      ? config.entries.filter((candidate) => {
          return (
            resolveEntryRelativeRepoPath(candidate, repoPath) !== undefined
          );
        })
      : [];

  if (
    profile === undefined &&
    entry === undefined &&
    ambiguousEntries.length > 1
  ) {
    throw new DevsyncError(
      "Sync set target matches multiple profiled entries.",
      {
        code: "TARGET_CONFLICT",
        details: [`Target: ${trimmedTarget}`],
        hint: "Pass --profile to choose which tracked profile entry to update.",
      },
    );
  }

  if (entry === undefined || entry.kind !== "directory") {
    throw new DevsyncError(
      "Repository set target is not inside a tracked directory entry.",
      {
        code: "TARGET_NOT_TRACKED",
        details: [`Target: ${trimmedTarget}`],
        hint: "Use a repository path under an existing tracked directory, or add the parent directory first.",
      },
    );
  }

  const resolvedTarget = await resolveTargetPath(trimmedTarget, entry, context);
  const relativePath = resolveEntryRelativeRepoPath(
    entry,
    resolvedTarget.repoPath,
  );

  if (relativePath === undefined) {
    throw new DevsyncError(
      "Repository set target is not inside a tracked directory entry.",
      {
        code: "TARGET_NOT_TRACKED",
        details: [`Target: ${trimmedTarget}`],
        hint: "Use a repository path under an existing tracked directory, or add the parent directory first.",
      },
    );
  }

  return {
    entry,
    localPath: resolvedTarget.localPath,
    relativePath,
    repoPath: resolvedTarget.repoPath,
    stats: resolvedTarget.stats,
  };
};

const updateEntryMode = (
  entry: ResolvedSyncConfigEntry,
  mode: SyncMode,
): {
  action: SyncSetAction;
  entry: ResolvedSyncConfigEntry;
  reason?: SyncSetReason;
} => {
  if (entry.mode === mode) {
    return {
      action: "unchanged",
      entry,
      reason: "already-set-on-entry",
    };
  }

  return {
    action: "updated",
    entry: {
      ...entry,
      mode,
    },
  };
};

const updateChildOverride = (
  entry: ResolvedSyncConfigEntry,
  baseEntry: ResolvedSyncConfigEntry | undefined,
  input: Readonly<{
    match: Extract<SyncSetScope, "exact" | "subtree">;
    mode: SyncMode;
    relativePath: string;
  }>,
): {
  action: SyncSetAction;
  entry: ResolvedSyncConfigEntry;
  reason?: SyncSetReason;
} => {
  const existingOverride = entry.overrides.find((override) => {
    return (
      override.match === input.match && override.path === input.relativePath
    );
  });
  const remainingOverrides = entry.overrides.filter((override) => {
    return !(
      override.match === input.match && override.path === input.relativePath
    );
  });
  const inheritedEntry =
    baseEntry === undefined
      ? {
          mode: entry.mode,
          overrides: remainingOverrides,
          profile: entry.profile,
        }
      : {
          mode: entry.mode,
          overrides: [
            ...baseEntry.overrides.filter((override) => {
              return !remainingOverrides.some((candidate) => {
                return (
                  candidate.match === override.match &&
                  candidate.path === override.path
                );
              });
            }),
            ...remainingOverrides,
          ],
          profile: entry.profile,
        };
  const inheritedMode =
    resolveRelativeSyncRule(inheritedEntry, input.relativePath, entry.profile)
      ?.mode ?? entry.mode;

  if (input.mode === inheritedMode) {
    if (existingOverride === undefined) {
      return {
        action: "unchanged",
        entry,
        reason: "already-inherited",
      };
    }

    return {
      action: "removed",
      entry: {
        ...entry,
        overrides: remainingOverrides,
      },
      reason: "reverted-to-inherited",
    };
  }

  if (existingOverride?.mode === input.mode) {
    return {
      action: "unchanged",
      entry,
      reason: "already-set",
    };
  }

  const nextOverride = {
    match: input.match,
    mode: input.mode,
    path: input.relativePath,
  } satisfies ResolvedSyncOverride;

  return {
    action: existingOverride === undefined ? "added" : "updated",
    entry: {
      ...entry,
      overrides: [...remainingOverrides, nextOverride],
    },
  };
};

export const setSyncTargetMode = async (
  request: SyncSetRequest,
  context: SyncContext,
): Promise<SyncSetResult> => {
  await ensureSyncRepository(context);

  const profile =
    request.profile === undefined
      ? undefined
      : normalizeSyncProfileName(request.profile);
  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const target = await resolveSetTarget(
    request.target,
    profile,
    config,
    context,
  );

  if (target.relativePath === "") {
    if (target.entry.kind === "file") {
      if (profile !== undefined) {
        throw new DevsyncError(
          "Profile-specific root updates are not supported for file entries.",
          {
            code: "FILE_ENTRY_SET_UNSUPPORTED",
            details: [`Target: ${target.repoPath}`, `Profile: ${profile}`],
            hint: "Track the file once without a profile, or move it under a tracked directory and use profile-specific child overrides instead.",
          },
        );
      }

      const update = updateEntryMode(target.entry, request.state);
      const nextConfig = createSyncConfigDocument({
        ...config,
        entries: config.entries.map((entry) => {
          if (entry.repoPath !== target.entry.repoPath) {
            return entry;
          }

          if (entry.profile !== target.entry.profile) {
            return entry;
          }

          return update.entry;
        }),
      });

      if (update.action !== "unchanged") {
        await writeValidatedSyncConfig(
          context.paths.syncDirectory,
          nextConfig,
          {
            environment: context.environment,
          },
        );
      }

      return {
        action: update.action,
        configPath: context.paths.configPath,
        entryRepoPath: target.entry.repoPath,
        localPath: target.localPath,
        mode: request.state,
        ...(target.entry.profile === undefined
          ? {}
          : { profile: target.entry.profile }),
        repoPath: target.repoPath,
        ...(update.reason === undefined ? {} : { reason: update.reason }),
        scope: "default",
        syncDirectory: context.paths.syncDirectory,
      };
    }

    if (profile !== undefined && target.entry.profile !== profile) {
      throw new DevsyncError(
        "Profile-specific root updates are not supported.",
        {
          code: "TARGET_NOT_TRACKED",
          details: [`Target: ${target.repoPath}`, `Profile: ${profile}`],
          hint: "Use a child path inside the tracked directory to create a profile-specific override.",
        },
      );
    }

    if (!request.recursive) {
      throw new DevsyncError("Tracked directory roots require --recursive.", {
        code: "RECURSIVE_REQUIRED",
        details: [`Target: ${target.localPath}`],
        hint: `Rerun with '--recursive' to change the default mode for ${target.entry.repoPath}.`,
      });
    }

    const update = updateEntryMode(target.entry, request.state);
    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== target.entry.repoPath) {
          return entry;
        }

        if (entry.profile !== target.entry.profile) {
          return entry;
        }

        return update.entry;
      }),
    });

    if (update.action !== "unchanged") {
      await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
        environment: context.environment,
      });
    }

    return {
      action: update.action,
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: request.state,
      ...(update.reason === undefined ? {} : { reason: update.reason }),
      repoPath: target.repoPath,
      scope: "default",
      syncDirectory: context.paths.syncDirectory,
    };
  }

  if (target.stats?.isDirectory() && !request.recursive) {
    throw new DevsyncError("Directory targets require --recursive.", {
      code: "RECURSIVE_REQUIRED",
      details: [`Target: ${target.localPath}`],
      hint: "Use '--recursive' for subtree rules, or point at a file for an exact override.",
    });
  }

  if (
    request.recursive &&
    target.stats !== undefined &&
    !target.stats.isDirectory()
  ) {
    throw new DevsyncError(
      "--recursive can only be used with directories or tracked directory roots.",
      {
        code: "RECURSIVE_INVALID",
        details: [`Target: ${target.localPath}`],
        hint: "Remove '--recursive' when setting the mode for a single file.",
      },
    );
  }

  const scope = request.recursive ? "subtree" : "exact";
  const profiledEntry =
    profile === undefined || target.entry.profile === profile
      ? target.entry
      : (config.entries.find((entry) => {
          return (
            entry.repoPath === target.entry.repoPath &&
            entry.profile === profile
          );
        }) ?? {
          ...target.entry,
          mode: target.entry.mode,
          name: `${target.entry.repoPath}#${profile}`,
          overrides: [],
          profile,
        });
  const workingConfig =
    profile === undefined || target.entry.profile === profile
      ? config
      : {
          ...config,
          entries: [...config.entries, profiledEntry],
        };
  const baseEntry = config.entries.find((entry) => {
    return (
      profiledEntry.profile !== undefined &&
      entry.repoPath === profiledEntry.repoPath &&
      entry.profile === undefined
    );
  });
  const update = updateChildOverride(profiledEntry, baseEntry, {
    match: scope,
    mode: request.state,
    relativePath: target.relativePath,
  });
  const nextConfig = createSyncConfigDocument({
    ...workingConfig,
    entries: workingConfig.entries.map((entry) => {
      if (entry.repoPath !== profiledEntry.repoPath) {
        return entry;
      }

      if (entry.profile !== profiledEntry.profile) {
        return entry;
      }

      return update.entry;
    }),
  });

  if (update.action !== "unchanged") {
    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
    });
  }

  return {
    action: update.action,
    configPath: context.paths.configPath,
    entryRepoPath: target.entry.repoPath,
    localPath: target.localPath,
    mode: request.state,
    ...(profile === undefined
      ? target.entry.profile === undefined
        ? {}
        : { profile: target.entry.profile }
      : { profile }),
    repoPath: target.repoPath,
    ...(update.reason === undefined ? {} : { reason: update.reason }),
    scope,
    syncDirectory: context.paths.syncDirectory,
  };
};
