import { readdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncConfigFilePath,
} from "#app/config/sync.ts";
import { resolveDevsyncSyncDirectory } from "#app/config/xdg.ts";

import {
  createSyncConfigDocument,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { SyncError } from "./error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
} from "./filesystem.ts";
import { ensureGitRepository, type GitService } from "./git.ts";
import {
  isExplicitLocalPath,
  isPathEqualOrNested,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import {
  isSecretArtifactPath,
  resolveArtifactRelativePath,
} from "./repo-artifacts.ts";

type SyncForgetRequest = Readonly<{
  target: string;
}>;

type SyncForgetResult = Readonly<{
  configPath: string;
  localPath: string;
  plainArtifactCount: number;
  repoPath: string;
  secretArtifactCount: number;
  syncDirectory: string;
}>;

const findMatchingTrackedEntry = (
  config: ResolvedSyncConfig,
  target: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => {
  const trimmedTarget = target.trim();
  const resolvedTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    environment,
    cwd,
  );
  const byLocalPath = config.entries.find((entry) => {
    return entry.localPath === resolvedTargetPath;
  });

  if (byLocalPath !== undefined || isExplicitLocalPath(trimmedTarget)) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return undefined;
  }

  return config.entries.find((entry) => {
    return entry.repoPath === normalizedRepoPath;
  });
};

const collectRepoArtifactCounts = async (
  targetPath: string,
  counts: {
    plain: number;
    secret: number;
  },
  relativePath: string,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (stats.isDirectory()) {
    counts.plain += 1;

    const entries = await listDirectoryEntries(targetPath);

    for (const entry of entries) {
      await collectRepoArtifactCounts(
        join(targetPath, entry.name),
        counts,
        posix.join(relativePath, entry.name),
      );
    }

    return;
  }

  if (isSecretArtifactPath(relativePath)) {
    counts.secret += 1;
  } else {
    counts.plain += 1;
  }
};

const collectEntryArtifactCounts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const artifactsRoot = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const counts = {
    plain: 0,
    secret: 0,
  };

  if (entry.kind === "directory") {
    await collectRepoArtifactCounts(
      join(artifactsRoot, ...entry.repoPath.split("/")),
      counts,
      entry.repoPath,
    );
  } else {
    await collectRepoArtifactCounts(
      join(artifactsRoot, ...entry.repoPath.split("/")),
      counts,
      entry.repoPath,
    );
    await collectRepoArtifactCounts(
      join(
        artifactsRoot,
        ...resolveArtifactRelativePath({
          category: "secret",
          repoPath: entry.repoPath,
        }).split("/"),
      ),
      counts,
      resolveArtifactRelativePath({
        category: "secret",
        repoPath: entry.repoPath,
      }),
    );
  }

  return {
    plainArtifactCount: counts.plain,
    secretArtifactCount: counts.secret,
  };
};

const pruneEmptyParentDirectories = async (
  startPath: string,
  rootPath: string,
) => {
  let currentPath = startPath;

  while (
    isPathEqualOrNested(currentPath, rootPath) &&
    currentPath !== rootPath
  ) {
    const stats = await getPathStats(currentPath);

    if (stats === undefined) {
      currentPath = dirname(currentPath);
      continue;
    }

    if (!stats.isDirectory()) {
      break;
    }

    const entries = await readdir(currentPath);

    if (entries.length > 0) {
      break;
    }

    await rm(currentPath, { force: true, recursive: true });
    currentPath = dirname(currentPath);
  }
};

const removeTrackedEntryArtifacts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const artifactsRoot = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const plainPath = join(artifactsRoot, ...entry.repoPath.split("/"));

  await removePathAtomically(plainPath);
  await pruneEmptyParentDirectories(dirname(plainPath), artifactsRoot);

  if (entry.kind === "directory") {
    return;
  }

  const secretPath = join(
    artifactsRoot,
    ...resolveArtifactRelativePath({
      category: "secret",
      repoPath: entry.repoPath,
    }).split("/"),
  );

  await removePathAtomically(secretPath);
  await pruneEmptyParentDirectories(dirname(secretPath), artifactsRoot);
};

export const forgetSyncTarget = async (
  request: SyncForgetRequest,
  dependencies: Readonly<{
    cwd: string;
    environment: NodeJS.ProcessEnv;
    git: GitService;
  }>,
): Promise<SyncForgetResult> => {
  try {
    const target = request.target.trim();

    if (target.length === 0) {
      throw new SyncError("Target path is required.");
    }

    const syncDirectory = resolveDevsyncSyncDirectory(dependencies.environment);

    await ensureGitRepository(syncDirectory, dependencies.git);

    const config = await readSyncConfig(
      syncDirectory,
      dependencies.environment,
    );
    const entry = findMatchingTrackedEntry(
      config,
      target,
      dependencies.environment,
      dependencies.cwd,
    );

    if (entry === undefined) {
      throw new SyncError(`No tracked sync entry matches: ${target}`);
    }

    const { plainArtifactCount, secretArtifactCount } =
      await collectEntryArtifactCounts(syncDirectory, entry);
    const nextConfig = createSyncConfigDocument(config);

    nextConfig.entries = sortSyncConfigEntries(
      nextConfig.entries.filter((configEntry) => {
        return configEntry.repoPath !== entry.repoPath;
      }),
    );

    await writeValidatedSyncConfig(
      syncDirectory,
      nextConfig,
      dependencies.environment,
    );
    await removeTrackedEntryArtifacts(syncDirectory, entry);

    return {
      configPath: resolveSyncConfigFilePath(syncDirectory),
      localPath: entry.localPath,
      plainArtifactCount,
      repoPath: entry.repoPath,
      secretArtifactCount,
      syncDirectory,
    };
  } catch (error: unknown) {
    if (error instanceof SyncError) {
      throw error;
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Sync forget failed.",
    );
  }
};
