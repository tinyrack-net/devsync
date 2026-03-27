import { lstat, readFile, readlink } from "node:fs/promises";
import { join, posix } from "node:path";

import {
  collectChildEntryPaths,
  type ResolvedSyncConfig,
  resolveManagedSyncMode,
} from "#app/config/sync.js";
import { isExecutableMode } from "#app/lib/file-mode.js";
import {
  type ProgressReporter,
  reportDetail,
  reportPhase,
} from "#app/lib/progress.js";
import { DevsyncError } from "./error.js";
import { getPathStats, listDirectoryEntries } from "./filesystem.js";
import { assertStorageSafeRepoPath } from "./repo-artifacts.js";

type SnapshotConfig = ResolvedSyncConfig &
  Readonly<{
    activeProfile?: string;
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

const reportLocalScanProgress = (
  reporter: ProgressReporter | undefined,
  state: { scannedEntryCount: number },
  repoPath: string,
  kind: "directory" | "file" | "other" | "symlink",
) => {
  state.scannedEntryCount += 1;

  if (reporter?.verbose) {
    reportDetail(reporter, `scanned local ${kind} ${repoPath}`);
    return;
  }

  if (state.scannedEntryCount % 100 === 0) {
    reportPhase(
      reporter,
      `Scanned ${state.scannedEntryCount} local filesystem entries...`,
    );
  }
};

const addLocalNode = async (
  snapshot: Map<string, SnapshotNode>,
  config: SnapshotConfig,
  repoPath: string,
  path: string,
  stats: Awaited<ReturnType<typeof lstat>>,
) => {
  assertStorageSafeRepoPath(repoPath);
  const mode = resolveManagedSyncMode(config, repoPath, config.activeProfile);

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
  reporter?: ProgressReporter,
  progressState: { scannedEntryCount: number } = { scannedEntryCount: 0 },
) => {
  const entries = await listDirectoryEntries(localDirectory);

  for (const entry of entries) {
    const localPath = join(localDirectory, entry.name);
    const repoPath = posix.join(repoPathPrefix, entry.name);

    if (childEntryPaths.has(repoPath)) {
      continue;
    }

    const stats = await lstat(localPath);
    reportLocalScanProgress(
      reporter,
      progressState,
      repoPath,
      stats.isDirectory()
        ? "directory"
        : stats.isSymbolicLink()
          ? "symlink"
          : stats.isFile()
            ? "file"
            : "other",
    );

    if (stats.isDirectory()) {
      assertStorageSafeRepoPath(repoPath);
      await walkLocalDirectory(
        snapshot,
        config,
        localPath,
        repoPath,
        childEntryPaths,
        reporter,
        progressState,
      );
      continue;
    }

    await addLocalNode(snapshot, config, repoPath, localPath, stats);
  }
};

export const buildLocalSnapshot = async (
  config: SnapshotConfig,
  reporter?: ProgressReporter,
) => {
  const snapshot = new Map<string, SnapshotNode>();
  const progressState = { scannedEntryCount: 0 };

  for (const entry of config.entries) {
    reportPhase(reporter, `Scanning tracked entry ${entry.repoPath}...`);
    const stats = await getPathStats(entry.localPath);

    if (stats === undefined) {
      reportDetail(reporter, `skipped missing local entry ${entry.repoPath}`);
      continue;
    }

    const entryMode = resolveManagedSyncMode(
      config,
      entry.repoPath,
      config.activeProfile,
    );

    if (entry.kind === "file") {
      if (entryMode === "ignore") {
        continue;
      }

      reportLocalScanProgress(
        reporter,
        progressState,
        entry.repoPath,
        stats.isSymbolicLink()
          ? "symlink"
          : stats.isFile()
            ? "file"
            : stats.isDirectory()
              ? "directory"
              : "other",
      );

      if (stats.isDirectory()) {
        throw new DevsyncError(
          `Sync entry ${entry.repoPath} expects a file, but found a directory: ${entry.localPath}`,
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
        `Sync entry ${entry.repoPath} expects a directory: ${entry.localPath}`,
      );
    }

    const childEntryPaths = new Set(
      collectChildEntryPaths(config, entry.repoPath),
    );

    if (entryMode === "ignore") {
      continue;
    }

    await walkLocalDirectory(
      snapshot,
      config,
      entry.localPath,
      entry.repoPath,
      childEntryPaths,
      reporter,
      progressState,
    );
    addSnapshotNode(snapshot, entry.repoPath, {
      type: "directory",
    });
  }

  return snapshot;
};
