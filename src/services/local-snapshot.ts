import { join, posix } from "node:path";

import { type ResolvedSyncConfig, resolveSyncMode } from "#app/config/sync.ts";
import { SyncError } from "./error.ts";
import type { FilesystemPort } from "./filesystem.ts";
import { assertStorageSafeRepoPath } from "./repo-artifacts.ts";

export type SnapshotNode =
  | Readonly<{
      type: "directory";
    }>
  | Readonly<{
      executable: boolean;
      secret: boolean;
      type: "file";
      contents: Uint8Array;
    }>
  | Readonly<{
      linkTarget: string;
      type: "symlink";
    }>;

export type FileSnapshotNode = Extract<
  SnapshotNode,
  Readonly<{ type: "file" }>
>;

export type FileLikeSnapshotNode = Extract<
  SnapshotNode,
  Readonly<{ type: "file" | "symlink" }>
>;

export const addSnapshotNode = (
  snapshot: Map<string, SnapshotNode>,
  repoPath: string,
  node: SnapshotNode,
) => {
  if (snapshot.has(repoPath)) {
    throw new SyncError(`Duplicate sync path generated for ${repoPath}`);
  }

  snapshot.set(repoPath, node);
};

const resolveManagedSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  const mode = resolveSyncMode(config, repoPath);

  if (mode === undefined) {
    throw new SyncError(`Unmanaged local sync path found: ${repoPath}`);
  }

  return mode;
};

const addLocalNode = async (
  snapshot: Map<string, SnapshotNode>,
  config: ResolvedSyncConfig,
  repoPath: string,
  path: string,
  stats: Awaited<ReturnType<FilesystemPort["lstat"]>>,
  filesystem: Pick<
    FilesystemPort,
    "isExecutableMode" | "readFile" | "readlink"
  >,
) => {
  assertStorageSafeRepoPath(repoPath);
  const mode = resolveManagedSyncMode(config, repoPath);

  if (mode === "ignore") {
    return;
  }

  if (stats.isDirectory()) {
    throw new SyncError(
      `Expected a file-like path but found a directory: ${path}`,
    );
  }

  if (stats.isSymbolicLink()) {
    if (mode === "secret") {
      throw new SyncError(
        `Secret sync paths must be regular files, not symlinks: ${repoPath}`,
      );
    }

    addSnapshotNode(snapshot, repoPath, {
      linkTarget: await filesystem.readlink(path),
      type: "symlink",
    });

    return;
  }

  if (!stats.isFile()) {
    throw new SyncError(`Unsupported filesystem entry: ${path}`);
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await filesystem.readFile(path),
    executable: filesystem.isExecutableMode(stats.mode),
    secret: mode === "secret",
    type: "file",
  });
};

const walkLocalDirectory = async (
  snapshot: Map<string, SnapshotNode>,
  config: ResolvedSyncConfig,
  localDirectory: string,
  repoPathPrefix: string,
  filesystem: Pick<
    FilesystemPort,
    | "isExecutableMode"
    | "listDirectoryEntries"
    | "lstat"
    | "readFile"
    | "readlink"
  >,
) => {
  const entries = await filesystem.listDirectoryEntries(localDirectory);

  for (const entry of entries) {
    const localPath = join(localDirectory, entry.name);
    const repoPath = posix.join(repoPathPrefix, entry.name);
    const stats = await filesystem.lstat(localPath);

    if (stats.isDirectory()) {
      assertStorageSafeRepoPath(repoPath);
      await walkLocalDirectory(
        snapshot,
        config,
        localPath,
        repoPath,
        filesystem,
      );
      continue;
    }

    await addLocalNode(
      snapshot,
      config,
      repoPath,
      localPath,
      stats,
      filesystem,
    );
  }
};

export const buildLocalSnapshot = async (
  config: ResolvedSyncConfig,
  filesystem: Pick<
    FilesystemPort,
    | "getPathStats"
    | "isExecutableMode"
    | "listDirectoryEntries"
    | "lstat"
    | "readFile"
    | "readlink"
  >,
) => {
  const snapshot = new Map<string, SnapshotNode>();

  for (const entry of config.entries) {
    const stats = await filesystem.getPathStats(entry.localPath);

    if (stats === undefined) {
      continue;
    }

    const entryMode = resolveManagedSyncMode(config, entry.repoPath);

    if (entry.kind === "file") {
      if (entryMode === "ignore") {
        continue;
      }

      if (stats.isDirectory()) {
        throw new SyncError(
          `Sync entry ${entry.name} expects a file, but found a directory: ${entry.localPath}`,
        );
      }

      await addLocalNode(
        snapshot,
        config,
        entry.repoPath,
        entry.localPath,
        stats,
        filesystem,
      );
      continue;
    }

    if (!stats.isDirectory()) {
      throw new SyncError(
        `Sync entry ${entry.name} expects a directory: ${entry.localPath}`,
      );
    }

    const snapshotSizeBeforeWalk = snapshot.size;
    await walkLocalDirectory(
      snapshot,
      config,
      entry.localPath,
      entry.repoPath,
      filesystem,
    );

    if (entryMode !== "ignore" || snapshot.size > snapshotSizeBeforeWalk) {
      addSnapshotNode(snapshot, entry.repoPath, {
        type: "directory",
      });
    }
  }

  return snapshot;
};
