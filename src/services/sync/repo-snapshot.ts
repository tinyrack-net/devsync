import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfig,
  resolveSyncMode,
  resolveSyncPlainDirectoryPath,
  resolveSyncSecretDirectoryPath,
} from "#app/config/sync.ts";

import { decryptSecretFile } from "./crypto.ts";
import { SyncError } from "./error.ts";
import {
  getPathStats,
  isExecutableMode,
  listDirectoryEntries,
  pathExists,
} from "./filesystem.ts";
import { addSnapshotNode, type SnapshotNode } from "./local-snapshot.ts";

const resolveManagedSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  const mode = resolveSyncMode(config, repoPath);

  if (mode === undefined) {
    throw new SyncError(`Unmanaged sync path found in repository: ${repoPath}`);
  }

  return mode;
};

const readPlainSnapshotNode = async (
  absolutePath: string,
  repoPath: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
) => {
  const mode = resolveManagedSyncMode(config, repoPath);

  if (mode === "ignore") {
    return;
  }

  if (findOwningSyncEntry(config, repoPath) === undefined) {
    throw new SyncError(
      `Unmanaged plain sync path found in repository: ${repoPath}`,
    );
  }

  if (mode === "secret") {
    throw new SyncError(
      `Secret sync path is stored in plain text in the repository: ${repoPath}`,
    );
  }

  const stats = await lstat(absolutePath);

  if (stats.isSymbolicLink()) {
    addSnapshotNode(snapshot, repoPath, {
      linkTarget: await readlink(absolutePath),
      type: "symlink",
    });

    return;
  }

  if (!stats.isFile()) {
    throw new SyncError(`Unsupported plain repository entry: ${absolutePath}`);
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await readFile(absolutePath),
    executable: isExecutableMode(stats.mode),
    secret: false,
    type: "file",
  });
};

const readPlainRepositoryTree = async (
  rootDirectory: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
  prefix?: string,
) => {
  if (!(await pathExists(rootDirectory))) {
    return;
  }

  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      await readPlainRepositoryTree(
        absolutePath,
        config,
        snapshot,
        relativePath,
      );
      continue;
    }

    await readPlainSnapshotNode(absolutePath, relativePath, config, snapshot);
  }
};

const readSecretRepositoryTree = async (
  rootDirectory: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
  prefix?: string,
) => {
  if (!(await pathExists(rootDirectory))) {
    return;
  }

  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      await readSecretRepositoryTree(
        absolutePath,
        config,
        snapshot,
        relativePath,
      );
      continue;
    }

    if (stats.isSymbolicLink()) {
      throw new SyncError(
        `Secret repository entries must be regular files, not symlinks: ${relativePath}`,
      );
    }

    if (!stats.isFile()) {
      throw new SyncError(
        `Unsupported secret repository entry: ${absolutePath}`,
      );
    }

    if (!relativePath.endsWith(".age")) {
      throw new SyncError(
        `Secret repository files must end with .age: ${relativePath}`,
      );
    }

    const repoPath = relativePath.slice(0, -".age".length);
    const mode = resolveManagedSyncMode(config, repoPath);

    if (findOwningSyncEntry(config, repoPath) === undefined) {
      throw new SyncError(
        `Unmanaged secret sync path found in repository: ${repoPath}`,
      );
    }

    if (mode === "ignore") {
      continue;
    }

    if (mode !== "secret") {
      throw new SyncError(
        `Plain sync path is stored in secret form in the repository: ${repoPath}`,
      );
    }

    addSnapshotNode(snapshot, repoPath, {
      contents: await decryptSecretFile(
        await readFile(absolutePath, "utf8"),
        config.age.identityFile,
      ),
      executable: isExecutableMode(stats.mode),
      secret: true,
      type: "file",
    });
  }
};

export const buildRepositorySnapshot = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
) => {
  const snapshot = new Map<string, SnapshotNode>();
  const plainDirectory = resolveSyncPlainDirectoryPath(syncDirectory);

  await readPlainRepositoryTree(plainDirectory, config, snapshot);
  await readSecretRepositoryTree(
    resolveSyncSecretDirectoryPath(syncDirectory),
    config,
    snapshot,
  );

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const plainPath = join(plainDirectory, ...entry.repoPath.split("/"));
    const stats = await getPathStats(plainPath);

    if (stats !== undefined && !stats.isDirectory()) {
      throw new SyncError(
        `Directory sync entry is not stored as a directory in the repository: ${entry.repoPath}`,
      );
    }

    const mode = resolveManagedSyncMode(config, entry.repoPath);
    const hasTrackedChildren = [...snapshot.keys()].some((repoPath) => {
      return repoPath.startsWith(`${entry.repoPath}/`);
    });

    if (stats?.isDirectory() && (mode !== "ignore" || hasTrackedChildren)) {
      addSnapshotNode(snapshot, entry.repoPath, {
        type: "directory",
      });
    }
  }

  return snapshot;
};
