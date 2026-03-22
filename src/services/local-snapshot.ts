import { lstat, readFile, readlink } from "node:fs/promises";
import { join, posix } from "node:path";

import {
  type ResolvedSyncConfig,
  resolveManagedSyncMode,
} from "#app/config/sync.ts";
import { isExecutableMode } from "#app/lib/file-mode.ts";
import { DevsyncError } from "./error.ts";
import { getPathStats, listDirectoryEntries } from "./filesystem.ts";
import { assertStorageSafeRepoPath } from "./repo-artifacts.ts";

type SnapshotConfig = ResolvedSyncConfig &
  Readonly<{
    activeMachine?: string;
  }>;

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
    throw new DevsyncError(`Duplicate sync path generated for ${repoPath}`);
  }

  snapshot.set(repoPath, node);
};

const addLocalNode = async (
  snapshot: Map<string, SnapshotNode>,
  config: SnapshotConfig,
  repoPath: string,
  path: string,
  stats: Awaited<ReturnType<typeof lstat>>,
) => {
  assertStorageSafeRepoPath(repoPath);
  const mode = resolveManagedSyncMode(config, repoPath, config.activeMachine);

  if (mode === "ignore") {
    return;
  }

  if (stats.isDirectory()) {
    throw new DevsyncError(
      `Expected a file-like path but found a directory: ${path}`,
    );
  }

  if (stats.isSymbolicLink()) {
    if (mode === "secret") {
      throw new DevsyncError(
        `Secret sync paths must be regular files, not symlinks: ${repoPath}`,
      );
    }

    addSnapshotNode(snapshot, repoPath, {
      linkTarget: await readlink(path),
      type: "symlink",
    });

    return;
  }

  if (!stats.isFile()) {
    throw new DevsyncError(`Unsupported filesystem entry: ${path}`);
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await readFile(path),
    executable: isExecutableMode(stats.mode),
    secret: mode === "secret",
    type: "file",
  });
};

const walkLocalDirectory = async (
  snapshot: Map<string, SnapshotNode>,
  config: SnapshotConfig,
  localDirectory: string,
  repoPathPrefix: string,
  childEntryPaths: ReadonlySet<string>,
) => {
  const entries = await listDirectoryEntries(localDirectory);

  for (const entry of entries) {
    const localPath = join(localDirectory, entry.name);
    const repoPath = posix.join(repoPathPrefix, entry.name);

    if (childEntryPaths.has(repoPath)) {
      continue;
    }

    const stats = await lstat(localPath);

    if (stats.isDirectory()) {
      assertStorageSafeRepoPath(repoPath);
      await walkLocalDirectory(
        snapshot,
        config,
        localPath,
        repoPath,
        childEntryPaths,
      );
      continue;
    }

    await addLocalNode(snapshot, config, repoPath, localPath, stats);
  }
};

export const buildLocalSnapshot = async (config: SnapshotConfig) => {
  const snapshot = new Map<string, SnapshotNode>();
  const allEntryPaths = new Set(config.entries.map((e) => e.repoPath));

  for (const entry of config.entries) {
    const stats = await getPathStats(entry.localPath);

    if (stats === undefined) {
      continue;
    }

    const entryMode = resolveManagedSyncMode(
      config,
      entry.repoPath,
      config.activeMachine,
    );

    if (entry.kind === "file") {
      if (entryMode === "ignore") {
        continue;
      }

      if (stats.isDirectory()) {
        throw new DevsyncError(
          `Sync entry ${entry.name} expects a file, but found a directory: ${entry.localPath}`,
        );
      }

      await addLocalNode(
        snapshot,
        config,
        entry.repoPath,
        entry.localPath,
        stats,
      );
      continue;
    }

    if (!stats.isDirectory()) {
      throw new DevsyncError(
        `Sync entry ${entry.name} expects a directory: ${entry.localPath}`,
      );
    }

    const childEntryPaths = new Set(
      [...allEntryPaths].filter(
        (p) => p !== entry.repoPath && p.startsWith(`${entry.repoPath}/`),
      ),
    );

    const snapshotSizeBeforeWalk = snapshot.size;
    await walkLocalDirectory(
      snapshot,
      config,
      entry.localPath,
      entry.repoPath,
      childEntryPaths,
    );

    if (entryMode !== "ignore" || snapshot.size > snapshotSizeBeforeWalk) {
      addSnapshotNode(snapshot, entry.repoPath, {
        type: "directory",
      });
    }
  }

  return snapshot;
};
