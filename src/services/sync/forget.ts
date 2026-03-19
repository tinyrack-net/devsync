import { readdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncConfigFilePath,
  resolveSyncPlainDirectoryPath,
  resolveSyncSecretDirectoryPath,
} from "#app/config/sync.ts";
import { resolveDevtoolsSyncDirectory } from "#app/config/xdg.ts";

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
  buildDirectoryKey,
  isPathEqualOrNested,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";

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
  const resolvedTargetPath = resolveCommandTargetPath(target, environment, cwd);
  const byLocalPath = config.entries.find((entry) => {
    return entry.localPath === resolvedTargetPath;
  });

  if (byLocalPath !== undefined) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(target.trim());

  if (normalizedRepoPath === undefined) {
    return undefined;
  }

  return config.entries.find((entry) => {
    return entry.repoPath === normalizedRepoPath;
  });
};

const collectRepoArtifactKeys = async (
  targetPath: string,
  category: "plain" | "secret",
  repoPath: string,
  keys: Set<string>,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (stats.isDirectory()) {
    if (category === "plain") {
      keys.add(`plain:${buildDirectoryKey(repoPath)}`);
    }

    const entries = await listDirectoryEntries(targetPath);

    for (const entry of entries) {
      await collectRepoArtifactKeys(
        join(targetPath, entry.name),
        category,
        posix.join(repoPath, entry.name),
        keys,
      );
    }

    return;
  }

  if (category === "secret") {
    keys.add(
      `secret:${
        repoPath.endsWith(".age") ? repoPath.slice(0, -".age".length) : repoPath
      }`,
    );

    return;
  }

  keys.add(`plain:${repoPath}`);
};

const collectEntryArtifactCounts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const plainKeys = new Set<string>();
  const secretKeys = new Set<string>();
  const plainPath = join(
    resolveSyncPlainDirectoryPath(syncDirectory),
    ...entry.repoPath.split("/"),
  );
  const secretPath =
    entry.kind === "directory"
      ? join(
          resolveSyncSecretDirectoryPath(syncDirectory),
          ...entry.repoPath.split("/"),
        )
      : `${join(resolveSyncSecretDirectoryPath(syncDirectory), ...entry.repoPath.split("/"))}.age`;

  await collectRepoArtifactKeys(plainPath, "plain", entry.repoPath, plainKeys);
  await collectRepoArtifactKeys(
    secretPath,
    "secret",
    entry.kind === "directory" ? entry.repoPath : `${entry.repoPath}.age`,
    secretKeys,
  );

  return {
    plainArtifactCount: plainKeys.size,
    secretArtifactCount: secretKeys.size,
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
  const plainRoot = resolveSyncPlainDirectoryPath(syncDirectory);
  const secretRoot = resolveSyncSecretDirectoryPath(syncDirectory);
  const plainPath = join(plainRoot, ...entry.repoPath.split("/"));
  const secretPath =
    entry.kind === "directory"
      ? join(secretRoot, ...entry.repoPath.split("/"))
      : `${join(secretRoot, ...entry.repoPath.split("/"))}.age`;

  await removePathAtomically(plainPath);
  await pruneEmptyParentDirectories(dirname(plainPath), plainRoot);
  await removePathAtomically(secretPath);
  await pruneEmptyParentDirectories(dirname(secretPath), secretRoot);
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

    const syncDirectory = resolveDevtoolsSyncDirectory(
      dependencies.environment,
    );

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
