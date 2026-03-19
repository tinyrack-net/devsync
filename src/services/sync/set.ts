import { isAbsolute, join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfigEntry,
  type ResolvedSyncConfigRule,
  readSyncConfig,
  resolveRelativeSyncMode,
  resolveSyncConfigFilePath,
  type SyncMode,
} from "#app/config/sync.ts";
import {
  resolveDevsyncSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";

import {
  createSyncConfigDocument,
  createSyncConfigDocumentEntry,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { SyncError } from "./error.ts";
import { getPathStats } from "./filesystem.ts";
import { ensureGitRepository, type GitService } from "./git.ts";
import {
  buildRepoPathWithinRoot,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";

type SyncSetRequest = Readonly<{
  recursive: boolean;
  state: SyncMode;
  target: string;
}>;

type SyncSetScope = "default" | "exact" | "subtree";
type SyncSetAction = "added" | "removed" | "unchanged" | "updated";

type SyncSetResult = Readonly<{
  action: SyncSetAction;
  configPath: string;
  entryRepoPath: string;
  localPath: string;
  mode: SyncMode;
  repoPath: string;
  scope: SyncSetScope;
  syncDirectory: string;
}>;

const isExplicitLocalPath = (target: string) => {
  return target === "~" || target.startsWith("~/") || isAbsolute(target);
};

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
  dependencies: Readonly<{
    cwd: string;
    environment: NodeJS.ProcessEnv;
  }>,
) => {
  if (isExplicitLocalPath(target)) {
    const localPath = resolveCommandTargetPath(
      target,
      dependencies.environment,
      dependencies.cwd,
    );
    const stats = await getPathStats(localPath);

    if (stats === undefined) {
      throw new SyncError(`Sync set target does not exist: ${localPath}`);
    }

    return {
      localPath,
      repoPath: buildRepoPathWithinRoot(
        localPath,
        resolveHomeDirectory(dependencies.environment),
        "Sync set target",
      ),
      stats,
    };
  }

  const repoPath = tryNormalizeRepoPathInput(target);

  if (repoPath === undefined) {
    throw new SyncError(
      `Sync set target must be a full local path or repository path: ${target}`,
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
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  dependencies: Readonly<{
    cwd: string;
    environment: NodeJS.ProcessEnv;
  }>,
) => {
  const trimmedTarget = target.trim();

  if (trimmedTarget.length === 0) {
    throw new SyncError("Target path is required.");
  }

  const localTargetPath = isExplicitLocalPath(trimmedTarget)
    ? resolveCommandTargetPath(
        trimmedTarget,
        dependencies.environment,
        dependencies.cwd,
      )
    : undefined;
  const repoPath =
    localTargetPath === undefined
      ? tryNormalizeRepoPathInput(trimmedTarget)
      : buildRepoPathWithinRoot(
          localTargetPath,
          resolveHomeDirectory(dependencies.environment),
          "Sync set target",
        );

  if (repoPath === undefined) {
    throw new SyncError(
      `Sync set target must be a full local path or repository path: ${trimmedTarget}`,
    );
  }

  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined || entry.kind !== "directory") {
    throw new SyncError(
      `Sync set target must be inside a tracked directory entry: ${trimmedTarget}`,
    );
  }

  const resolvedTarget = await resolveTargetPath(
    trimmedTarget,
    entry,
    dependencies,
  );
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

const updateDefaultMode = (
  entry: ResolvedSyncConfigEntry,
  mode: SyncMode,
): {
  action: SyncSetAction;
  entry: ResolvedSyncConfigEntry;
} => {
  if (entry.defaultMode === mode) {
    return {
      action: "unchanged",
      entry,
    };
  }

  return {
    action: "updated",
    entry: {
      ...entry,
      defaultMode: mode,
    },
  };
};

const updateChildRule = (
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
  const existingRule = entry.rules.find((rule) => {
    return rule.match === input.match && rule.path === input.relativePath;
  });
  const remainingRules = entry.rules.filter((rule) => {
    return !(rule.match === input.match && rule.path === input.relativePath);
  });
  const inheritedMode = resolveRelativeSyncMode(
    entry.defaultMode,
    remainingRules,
    input.relativePath,
  );

  if (input.mode === inheritedMode) {
    if (existingRule === undefined) {
      return {
        action: "unchanged",
        entry,
      };
    }

    return {
      action: "removed",
      entry: {
        ...entry,
        rules: remainingRules,
      },
    };
  }

  if (existingRule?.mode === input.mode) {
    return {
      action: "unchanged",
      entry,
    };
  }

  const nextRule = {
    match: input.match,
    mode: input.mode,
    path: input.relativePath,
  } satisfies ResolvedSyncConfigRule;

  return {
    action: existingRule === undefined ? "added" : "updated",
    entry: {
      ...entry,
      rules: [...remainingRules, nextRule],
    },
  };
};

export const setSyncTargetMode = async (
  request: SyncSetRequest,
  dependencies: Readonly<{
    cwd: string;
    environment: NodeJS.ProcessEnv;
    git: GitService;
  }>,
): Promise<SyncSetResult> => {
  try {
    const syncDirectory = resolveDevsyncSyncDirectory(dependencies.environment);

    await ensureGitRepository(syncDirectory, dependencies.git);

    const config = await readSyncConfig(
      syncDirectory,
      dependencies.environment,
    );
    const target = await resolveSetTarget(request.target, config, dependencies);

    if (target.relativePath === "") {
      if (!request.recursive) {
        throw new SyncError(
          "Tracked directory roots require --recursive to update the default mode.",
        );
      }

      const update = updateDefaultMode(target.entry, request.state);
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
          syncDirectory,
          nextConfig,
          dependencies.environment,
        );
      }

      return {
        action: update.action,
        configPath: resolveSyncConfigFilePath(syncDirectory),
        entryRepoPath: target.entry.repoPath,
        localPath: target.localPath,
        mode: request.state,
        repoPath: target.repoPath,
        scope: "default",
        syncDirectory,
      };
    }

    if (target.stats?.isDirectory() && !request.recursive) {
      throw new SyncError(
        "Directory targets require --recursive. Use a file path for exact rules.",
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
    const update = updateChildRule(target.entry, {
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
      await writeValidatedSyncConfig(
        syncDirectory,
        nextConfig,
        dependencies.environment,
      );
    }

    return {
      action: update.action,
      configPath: resolveSyncConfigFilePath(syncDirectory),
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: request.state,
      repoPath: target.repoPath,
      scope,
      syncDirectory,
    };
  } catch (error: unknown) {
    if (error instanceof SyncError) {
      throw error;
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Sync set failed.",
    );
  }
};
