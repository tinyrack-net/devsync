import { readdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import {
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.js";
import { isPathEqualOrNested } from "#app/lib/path.js";
import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.js";
import { DevsyncError } from "./error.js";
import {
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
} from "./filesystem.js";
import { resolveTrackedEntry } from "./paths.js";
import {
  collectArtifactNamespaces,
  isSecretArtifactPath,
  resolveArtifactRelativePath,
  resolveEntryArtifactPath,
} from "./repo-artifacts.js";
import { ensureSyncRepository, resolveSyncPaths } from "./runtime.js";

export type SyncForgetRequest = Readonly<{
  target: string;
}>;

export type SyncForgetResult = Readonly<{
  configPath: string;
  localPath: string;
  plainArtifactCount: number;
  repoPath: string;
  secretArtifactCount: number;
  syncDirectory: string;
}>;

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
  const namespaces = collectArtifactNamespaces([entry]);

  for (const profile of namespaces) {
    await collectRepoArtifactCounts(
      resolveEntryArtifactPath(artifactsRoot, entry, profile),
      counts,
      resolveArtifactRelativePath({
        category: "plain",
        profile,
        repoPath: entry.repoPath,
      }),
    );

    if (entry.kind !== "directory") {
      const secretRelativePath = resolveArtifactRelativePath({
        category: "secret",
        profile,
        repoPath: entry.repoPath,
      });

      await collectRepoArtifactCounts(
        join(artifactsRoot, ...secretRelativePath.split("/")),
        counts,
        secretRelativePath,
      );
    }
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
  const namespaces = collectArtifactNamespaces([entry]);

  for (const profile of namespaces) {
    const plainPath = resolveEntryArtifactPath(artifactsRoot, entry, profile);

    await removePathAtomically(plainPath);
    await pruneEmptyParentDirectories(dirname(plainPath), artifactsRoot);

    if (entry.kind !== "directory") {
      const secretPath = join(
        artifactsRoot,
        ...resolveArtifactRelativePath({
          category: "secret",
          profile,
          repoPath: entry.repoPath,
        }).split("/"),
      );

      await removePathAtomically(secretPath);
      await pruneEmptyParentDirectories(dirname(secretPath), artifactsRoot);
    }
  }
};

export const forgetSyncTarget = async (
  request: SyncForgetRequest,
  environment: NodeJS.ProcessEnv,
  cwd: string,
): Promise<SyncForgetResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.");
  }

  const { syncDirectory, configPath } = resolveSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, environment);
  const entry = resolveTrackedEntry(target, config.entries, environment, cwd);

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`);
  }

  const { plainArtifactCount, secretArtifactCount } =
    await collectEntryArtifactCounts(syncDirectory, entry);
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.filter((configEntry) => {
      return configEntry.repoPath !== entry.repoPath;
    }),
  });

  await writeValidatedSyncConfig(syncDirectory, nextConfig, environment);
  await removeTrackedEntryArtifacts(syncDirectory, entry);

  return {
    configPath,
    localPath: entry.localPath,
    plainArtifactCount,
    repoPath: entry.repoPath,
    secretArtifactCount,
    syncDirectory,
  };
};
