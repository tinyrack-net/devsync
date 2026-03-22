import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveEntryRelativeRepoPath,
  type SyncMode,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import { getPathStats } from "./filesystem.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  isExplicitLocalPath,
  resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncSetRequest = Readonly<{
  state: SyncMode;
  target: string;
}>;

type SyncSetAction = "added" | "removed" | "unchanged" | "updated";
type SyncSetReason = "already-set";

export type SyncSetResult = Readonly<{
  action: SyncSetAction;
  configPath: string;
  entryRepoPath: string;
  localPath: string;
  mode: SyncMode;
  repoPath: string;
  reason?: SyncSetReason;
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
      hint: "Pass a tracked path, for example 'devsync mode ~/.ssh/id_ed25519 secret'.",
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

    const exactEntry = config.entries.find((e) => e.repoPath === localRepoPath);

    if (exactEntry !== undefined) {
      return {
        entry: exactEntry,
        localPath: localTargetPath,
        relativePath: "",
        repoPath: localRepoPath,
        stats: localStats,
      };
    }

    const parentEntry = findOwningSyncEntry(config, localRepoPath);

    if (parentEntry?.kind === "directory") {
      const relativePath = resolveEntryRelativeRepoPath(
        parentEntry,
        localRepoPath,
      );

      if (relativePath !== undefined) {
        return {
          entry: parentEntry,
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
          hint: "Track the parent directory first with 'devsync track', then use 'devsync mode' on the child path.",
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

  const exactEntry = config.entries.find((e) => e.repoPath === repoPath);

  if (exactEntry !== undefined) {
    const resolvedTarget = await resolveTargetPath(
      trimmedTarget,
      exactEntry,
      context,
    );

    return {
      entry: exactEntry,
      localPath: resolvedTarget.localPath,
      relativePath: "",
      repoPath,
      stats: resolvedTarget.stats,
    };
  }

  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined || entry.kind !== "directory") {
    throw new DevsyncError(
      "Repository set target is not inside a tracked directory entry.",
      {
        code: "TARGET_NOT_TRACKED",
        details: [`Target: ${trimmedTarget}`],
        hint: "Use a repository path under an existing tracked directory, or track it first with 'devsync track'.",
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
        hint: "Use a repository path under an existing tracked directory, or track it first with 'devsync track'.",
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
    const action =
      target.entry.mode === request.state ? "unchanged" : "updated";
    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== target.entry.repoPath) {
          return entry;
        }

        return {
          ...entry,
          mode: request.state,
        };
      }),
    });

    if (action !== "unchanged") {
      await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
        environment: context.environment,
      });
    }

    return {
      action,
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: request.state,
      repoPath: target.repoPath,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const childKind = target.stats?.isDirectory() ? "directory" : "file";
  const childRepoPath = target.repoPath;
  const childConfiguredLocalPath = buildConfiguredHomeLocalPath(childRepoPath);

  const existingChild = config.entries.find(
    (e) => e.repoPath === childRepoPath,
  );

  if (existingChild !== undefined) {
    if (existingChild.mode === request.state) {
      return {
        action: "unchanged",
        configPath: context.paths.configPath,
        entryRepoPath: target.entry.repoPath,
        localPath: target.localPath,
        mode: request.state,
        repoPath: target.repoPath,
        reason: "already-set",
        syncDirectory: context.paths.syncDirectory,
      };
    }

    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== childRepoPath) {
          return entry;
        }

        return { ...entry, mode: request.state };
      }),
    });

    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
    });

    return {
      action: "updated",
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: request.state,
      repoPath: target.repoPath,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  if (request.state === target.entry.mode) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: request.state,
      repoPath: target.repoPath,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const newEntry: ResolvedSyncConfigEntry = {
    configuredLocalPath: childConfiguredLocalPath,
    kind: childKind,
    localPath: target.localPath,
    machines: [],
    mode: request.state,
    modeExplicit: true,
    name: childRepoPath,
    repoPath: childRepoPath,
  };

  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: [...config.entries, newEntry],
  });

  await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
    environment: context.environment,
  });

  return {
    action: "added",
    configPath: context.paths.configPath,
    entryRepoPath: target.entry.repoPath,
    localPath: target.localPath,
    mode: request.state,
    repoPath: target.repoPath,
    syncDirectory: context.paths.syncDirectory,
  };
};
