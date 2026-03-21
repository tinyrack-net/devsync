import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfigEntry,
  type ResolvedSyncOverride,
  readSyncConfig,
  resolveEntryRelativeRepoPath,
  resolveRelativeSyncMode,
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
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  context: Pick<SyncContext, "cwd" | "environment" | "paths">,
) => {
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

    const entry = findOwningSyncEntry(config, localRepoPath);

    if (
      explicitLocalPath &&
      entry !== undefined &&
      entry.kind === "file" &&
      entry.localPath === localTargetPath
    ) {
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

  const entry = findOwningSyncEntry(config, repoPath);

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
  const inheritedMode = resolveRelativeSyncMode(
    entry.mode,
    remainingOverrides,
    input.relativePath,
  );

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

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const target = await resolveSetTarget(request.target, config, context);

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
  const update = updateChildOverride(target.entry, {
    match: scope,
    mode: request.state,
    relativePath: target.relativePath,
  });
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((entry) => {
      if (entry.repoPath !== target.entry.repoPath) {
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
    repoPath: target.repoPath,
    ...(update.reason === undefined ? {} : { reason: update.reason }),
    scope,
    syncDirectory: context.paths.syncDirectory,
  };
};
