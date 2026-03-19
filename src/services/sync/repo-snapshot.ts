import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import {
  matchesIgnoreGlob,
  matchesSecretGlob,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
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

const findOwningEntry = (
  config: ResolvedSyncConfig,
  repoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  return config.entries.find((entry) => {
    return (
      entry.repoPath === repoPath ||
      (entry.kind === "directory" && repoPath.startsWith(`${entry.repoPath}/`))
    );
  });
};

const readPlainSnapshotNode = async (
  absolutePath: string,
  repoPath: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
) => {
  if (matchesIgnoreGlob(config, repoPath)) {
    return;
  }

  const owningEntry = findOwningEntry(config, repoPath);

  if (owningEntry === undefined) {
    throw new SyncError(
      `Unmanaged plain sync path found in repository: ${repoPath}`,
    );
  }

  if (matchesSecretGlob(config, repoPath)) {
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
      if (matchesIgnoreGlob(config, relativePath)) {
        continue;
      }

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
      if (matchesIgnoreGlob(config, relativePath)) {
        continue;
      }

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

    if (matchesIgnoreGlob(config, repoPath)) {
      continue;
    }

    const owningEntry = findOwningEntry(config, repoPath);

    if (owningEntry === undefined) {
      throw new SyncError(
        `Unmanaged secret sync path found in repository: ${repoPath}`,
      );
    }

    if (!matchesSecretGlob(config, repoPath)) {
      throw new SyncError(
        `Secret repository file does not match any secret glob: ${repoPath}`,
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

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    if (matchesIgnoreGlob(config, entry.repoPath)) {
      continue;
    }

    const stats = await getPathStats(
      join(plainDirectory, ...entry.repoPath.split("/")),
    );

    if (stats === undefined) {
      continue;
    }

    if (!stats.isDirectory()) {
      throw new SyncError(
        `Directory sync entry is not stored as a directory in the repository: ${entry.repoPath}`,
      );
    }

    addSnapshotNode(snapshot, entry.repoPath, {
      type: "directory",
    });
  }

  await readPlainRepositoryTree(plainDirectory, config, snapshot);
  await readSecretRepositoryTree(
    resolveSyncSecretDirectoryPath(syncDirectory),
    config,
    snapshot,
  );

  return snapshot;
};
