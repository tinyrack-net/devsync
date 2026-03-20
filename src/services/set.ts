import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfigEntry,
  type ResolvedSyncOverride,
  readSyncConfig,
  resolveRelativeSyncMode,
  type SyncMode,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  createSyncConfigDocumentEntry,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { SyncError } from "./error.ts";
import {
  buildRepoPathWithinRoot,
  isExplicitLocalPath,
  resolveCommandTargetPath,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import { runSyncUseCase } from "./use-case.ts";

export type SyncSetRequest = Readonly<{
  recursive: boolean;
  state: SyncMode;
  target: string;
}>;

type SyncSetScope = "default" | "exact" | "subtree";
type SyncSetAction = "added" | "removed" | "unchanged" | "updated";

export type SyncSetResult = Readonly<{
  action: SyncSetAction;
  configPath: string;
  entryRepoPath: string;
  localPath: string;
  mode: SyncMode;
  repoPath: string;
  scope: SyncSetScope;
  syncDirectory: string;
}>;

const resolveEntryRelativeRepoPath = (
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

const resolveTargetPath = async (
  target: string,
  entry: ResolvedSyncConfigEntry,
  context: Pick<SyncContext, "cwd" | "environment" | "paths" | "ports">,
) => {
  if (isExplicitLocalPath(target)) {
    const localPath = resolveCommandTargetPath(
      target,
      context.environment,
      context.cwd,
    );
    const stats = await context.ports.filesystem.getPathStats(localPath);

    if (stats === undefined) {
      throw new SyncError(`Sync set target does not exist: ${localPath}`);
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
    throw new SyncError(
      `Sync set target must be a local path or repository path: ${target}`,
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
    stats: await context.ports.filesystem.getPathStats(localPath),
  };
};

const resolveSetTarget = async (
  target: string,
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  context: Pick<SyncContext, "cwd" | "environment" | "paths" | "ports">,
) => {
  const trimmedTarget = target.trim();

  if (trimmedTarget.length === 0) {
    throw new SyncError("Target path is required.");
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
    const localStats =
      await context.ports.filesystem.getPathStats(localTargetPath);

    if (explicitLocalPath && localStats === undefined) {
      throw new SyncError(`Sync set target does not exist: ${localTargetPath}`);
    }

    const entry = findOwningSyncEntry(config, localRepoPath);

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
      throw new SyncError(
        `Sync set target must be inside a tracked directory entry: ${trimmedTarget}`,
      );
    }
  }

  const repoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (repoPath === undefined) {
    throw new SyncError(
      `Sync set target must be a local path or repository path: ${trimmedTarget}`,
    );
  }

  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined || entry.kind !== "directory") {
    throw new SyncError(
      `Sync set target must be inside a tracked directory entry: ${trimmedTarget}`,
    );
  }

  const resolvedTarget = await resolveTargetPath(trimmedTarget, entry, context);
  const relativePath = resolveEntryRelativeRepoPath(
    entry,
    resolvedTarget.repoPath,
  );

  if (relativePath === undefined) {
    throw new SyncError(
      `Sync set target must be inside a tracked directory entry: ${trimmedTarget}`,
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
} => {
  if (entry.mode === mode) {
    return {
      action: "unchanged",
      entry,
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
  input: Readonly<{
    match: Extract<SyncSetScope, "exact" | "subtree">;
    mode: SyncMode;
    relativePath: string;
  }>,
): {
  action: SyncSetAction;
  entry: ResolvedSyncConfigEntry;
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
      };
    }

    return {
      action: "removed",
      entry: {
        ...entry,
        overrides: remainingOverrides,
      },
    };
  }

  if (existingOverride?.mode === input.mode) {
    return {
      action: "unchanged",
      entry,
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
  return runSyncUseCase("Sync set failed.", async () => {
    await ensureSyncRepository(context);

    const config = await readSyncConfig(
      context.paths.syncDirectory,
      context.environment,
    );
    const target = await resolveSetTarget(request.target, config, context);

    if (target.relativePath === "") {
      if (!request.recursive) {
        throw new SyncError(
          "Tracked directory roots require --recursive to update the entry mode.",
        );
      }

      const update = updateEntryMode(target.entry, request.state);
      const nextConfig = createSyncConfigDocument(config);

      nextConfig.entries = sortSyncConfigEntries(
        nextConfig.entries.map((entry) => {
          if (entry.repoPath !== target.entry.repoPath) {
            return entry;
          }

          return createSyncConfigDocumentEntry(update.entry);
        }),
      );

      if (update.action !== "unchanged") {
        await writeValidatedSyncConfig(
          context.paths.syncDirectory,
          nextConfig,
          {
            environment: context.environment,
            filesystem: context.ports.filesystem,
          },
        );
      }

      return {
        action: update.action,
        configPath: context.paths.configPath,
        entryRepoPath: target.entry.repoPath,
        localPath: target.localPath,
        mode: request.state,
        repoPath: target.repoPath,
        scope: "default",
        syncDirectory: context.paths.syncDirectory,
      };
    }

    if (target.stats?.isDirectory() && !request.recursive) {
      throw new SyncError(
        "Directory targets require --recursive. Use a file path for exact overrides.",
      );
    }

    if (
      request.recursive &&
      target.stats !== undefined &&
      !target.stats.isDirectory()
    ) {
      throw new SyncError(
        "--recursive can only be used with directories or tracked directory roots.",
      );
    }

    const scope = request.recursive ? "subtree" : "exact";
    const update = updateChildOverride(target.entry, {
      match: scope,
      mode: request.state,
      relativePath: target.relativePath,
    });
    const nextConfig = createSyncConfigDocument(config);

    nextConfig.entries = sortSyncConfigEntries(
      nextConfig.entries.map((entry) => {
        if (entry.repoPath !== target.entry.repoPath) {
          return entry;
        }

        return createSyncConfigDocumentEntry(update.entry);
      }),
    );

    if (update.action !== "unchanged") {
      await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
        environment: context.environment,
        filesystem: context.ports.filesystem,
      });
    }

    return {
      action: update.action,
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: request.state,
      repoPath: target.repoPath,
      scope,
      syncDirectory: context.paths.syncDirectory,
    };
  });
};
