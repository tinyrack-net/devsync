import { readdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
  type ResolvedSyncConfigEntry,
  readSyncConfig,
} from "#app/config/sync.ts";
import { DevsyncError } from "#app/lib/error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
} from "#app/lib/filesystem.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import { isPathEqualOrNested } from "#app/lib/path.ts";
import {
  buildSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { resolveTrackedEntry } from "./paths.ts";
import {
  collectArtifactProfiles,
  isSecretArtifactPath,
  resolveArtifactRelativePath,
} from "./repo-artifacts.ts";
import {
  resolveSyncConfigResolutionContext,
  resolveSyncPaths,
} from "./runtime.ts";

export type UntrackRequest = Readonly<{
  target: string;
}>;

export type UntrackResult = Readonly<{
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
  const artifactsRoot = syncDirectory;
  const counts = {
    plain: 0,
    secret: 0,
  };
  const artifactProfiles = collectArtifactProfiles([entry]);

  for (const profile of artifactProfiles) {
    const plainRelativePath = resolveArtifactRelativePath({
      category: "plain",
      profile,
      repoPath: entry.repoPath,
    });

    await collectRepoArtifactCounts(
      join(artifactsRoot, ...plainRelativePath.split("/")),
      counts,
      plainRelativePath,
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
  const artifactsRoot = syncDirectory;
  const artifactProfiles = collectArtifactProfiles([entry]);

  for (const profile of artifactProfiles) {
    const plainPath = join(
      artifactsRoot,
      ...resolveArtifactRelativePath({
        category: "plain",
        profile,
        repoPath: entry.repoPath,
      }).split("/"),
    );

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

export const untrackTarget = async (
  request: UntrackRequest,
  cwd: string,
): Promise<UntrackResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.");
  }

  const { syncDirectory, configPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await ensureGitRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, context);
  const entry = resolveTrackedEntry(
    target,
    config.entries,
    cwd,
    context.homeDirectory,
  );

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`);
  }

  const { plainArtifactCount, secretArtifactCount } =
    await collectEntryArtifactCounts(syncDirectory, entry);
  const nextConfig = buildSyncConfigDocument({
    ...config,
    entries: config.entries.filter((configEntry) => {
      return configEntry.repoPath !== entry.repoPath;
    }),
  });

  await writeValidatedSyncConfig(syncDirectory, nextConfig, context);
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
