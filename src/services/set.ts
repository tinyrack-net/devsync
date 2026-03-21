import { join } from "node:path";

import {
  findOwningSyncEntry,
  normalizeSyncMachineName,
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
  machine?: string;
  recursive: boolean;
  state: SyncMode;
  target: string;
}>;

type SyncSetScope = "default" | "exact" | "subtree";
type SyncSetAction = "added" | "removed" | "unchanged" | "updated";
type SyncSetReason =
  | "already-inherited"
  | "already-set"
  | "reverted-to-inherited";

export type SyncSetResult = Readonly<{
  action: SyncSetAction;
  configPath: string;
  entryRepoPath: string;
  localPath: string;
  mode: SyncMode;
  machine?: string;
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

export const resolveSetTarget = async (
  target: string,
  machine: string | undefined,
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  context: Pick<SyncContext, "cwd" | "environment" | "paths">,
) => {
  const matchingEntries = config.entries
    .filter((entry) => {
      return machine === undefined
        ? true
        : entry.machine === machine || entry.machine === undefined;
    })
    .sort((left, right) => {
      if (machine === undefined || left.machine === right.machine) {
        return 0;
      }

      if (left.machine === machine) {
        return -1;
      }

      if (right.machine === machine) {
        return 1;
      }

      return 0;
    });
  const trimmedTarget = target.trim();

  if (trimmedTarget.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a local path or repository path after the mode, for example 'devsync rule set secret ~/.ssh/id_ed25519'.",
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
      machine === undefined
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
      if (machine !== undefined) {
        throw new DevsyncError(
          "Machine-specific root updates are not supported for file entries.",
          {
            code: "FILE_ENTRY_SET_UNSUPPORTED",
            details: [`Target: ${trimmedTarget}`, `Machine: ${machine}`],
            hint: "Track the file once without a machine, or move it under a tracked directory and use machine-specific child rules instead.",
          },
        );
      }

      if (entry.machine !== undefined) {
        throw new DevsyncError(
          "Tracked file entries cannot be updated with 'devsync rule set'.",
          {
            code: "FILE_ENTRY_SET_UNSUPPORTED",
            details: [`Target: ${trimmedTarget}`],
            hint: "Use 'devsync entry mode' for tracked roots, or untrack and track the file again with the desired mode.",
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
      machine === undefined &&
      entry === undefined &&
      ambiguousEntries.length > 1
    ) {
      throw new DevsyncError(
        "Sync set target matches multiple machine entries.",
        {
          code: "TARGET_CONFLICT",
          details: [`Target: ${trimmedTarget}`],
          hint: "Pass --machine to choose which tracked machine entry to update.",
        },
      );
    }

    if (explicitLocalPath) {
      throw new DevsyncError(
        "Local set target is not inside a tracked directory entry.",
        {
          code: "TARGET_NOT_TRACKED",
          details: [`Target: ${trimmedTarget}`],
          hint: "Track the parent directory first, then apply nested rules with 'devsync rule set'.",
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
    machine === undefined
      ? config.entries.filter((candidate) => {
          return (
            resolveEntryRelativeRepoPath(candidate, repoPath) !== undefined
          );
        })
      : [];

  if (
    machine === undefined &&
    entry === undefined &&
    ambiguousEntries.length > 1
  ) {
    throw new DevsyncError(
      "Sync set target matches multiple machine entries.",
      {
        code: "TARGET_CONFLICT",
        details: [`Target: ${trimmedTarget}`],
        hint: "Pass --machine to choose which tracked machine entry to update.",
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
          machine: entry.machine,
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
          machine: entry.machine,
        };
  const inheritedMode =
    resolveRelativeSyncRule(inheritedEntry, input.relativePath, entry.machine)
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

  const machine =
    request.machine === undefined
      ? undefined
      : normalizeSyncMachineName(request.machine);
  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const target = await resolveSetTarget(
    request.target,
    machine,
    config,
    context,
  );

  if (target.relativePath === "") {
    throw new DevsyncError(
      "Rule targets must be child paths inside tracked directory roots.",
      {
        code: "TARGET_NOT_TRACKED",
        details: [`Target: ${target.repoPath}`],
        hint: "Use 'devsync entry mode' for tracked roots, or point 'devsync rule set' at a child path inside a tracked directory.",
      },
    );
  }

  if (target.stats?.isDirectory() && !request.recursive) {
    throw new DevsyncError("Directory targets require --recursive.", {
      code: "RECURSIVE_REQUIRED",
      details: [`Target: ${target.localPath}`],
      hint: "Use '--recursive' for subtree rules, or point at a file for an exact rule.",
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
  const machinedEntry =
    machine === undefined || target.entry.machine === machine
      ? target.entry
      : (config.entries.find((entry) => {
          return (
            entry.repoPath === target.entry.repoPath &&
            entry.machine === machine
          );
        }) ?? {
          ...target.entry,
          mode: target.entry.mode,
          modeExplicit: false,
          name: `${target.entry.repoPath}#${machine}`,
          overrides: [],
          machine,
        });
  const workingConfig =
    machine === undefined || target.entry.machine === machine
      ? config
      : {
          ...config,
          entries: [...config.entries, machinedEntry],
        };
  const baseEntry = config.entries.find((entry) => {
    return (
      machinedEntry.machine !== undefined &&
      entry.repoPath === machinedEntry.repoPath &&
      entry.machine === undefined
    );
  });
  const update = updateChildOverride(machinedEntry, baseEntry, {
    match: scope,
    mode: request.state,
    relativePath: target.relativePath,
  });
  const nextConfig = createSyncConfigDocument({
    ...workingConfig,
    entries: workingConfig.entries.map((entry) => {
      if (entry.repoPath !== machinedEntry.repoPath) {
        return entry;
      }

      if (entry.machine !== machinedEntry.machine) {
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
    ...(machine === undefined
      ? target.entry.machine === undefined
        ? {}
        : { machine: target.entry.machine }
      : { machine }),
    repoPath: target.repoPath,
    ...(update.reason === undefined ? {} : { reason: update.reason }),
    scope,
    syncDirectory: context.paths.syncDirectory,
  };
};
