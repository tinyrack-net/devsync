import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfig,
  resolveManagedSyncMode,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";

import { decryptSecretFile } from "./crypto.ts";
import { DevsyncError } from "./error.ts";
import {
  getPathStats,
  isExecutableMode,
  listDirectoryEntries,
  pathExists,
} from "./filesystem.ts";
import { addSnapshotNode, type SnapshotNode } from "./local-snapshot.ts";
import {
  assertStorageSafeRepoPath,
  isSecretArtifactPath,
  stripSecretArtifactSuffix,
} from "./repo-artifacts.ts";

const readPlainSnapshotNode = async (
  absolutePath: string,
  repoPath: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
) => {
  assertStorageSafeRepoPath(repoPath);
  const mode = resolveManagedSyncMode(config, repoPath);

  if (mode === "ignore") {
    return;
  }

  if (findOwningSyncEntry(config, repoPath) === undefined) {
    throw new DevsyncError(
      `Unmanaged plain sync path found in repository: ${repoPath}`,
    );
  }

  if (mode === "secret") {
    throw new DevsyncError(
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
    throw new DevsyncError(
      `Unsupported plain repository entry: ${absolutePath}`,
    );
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await readFile(absolutePath),
    executable: isExecutableMode(stats.mode),
    secret: false,
    type: "file",
  });
};

const readRepositoryTree = async (
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
      assertStorageSafeRepoPath(relativePath);
      await readRepositoryTree(absolutePath, config, snapshot, relativePath);
      continue;
    }

    if (stats.isSymbolicLink()) {
      if (isSecretArtifactPath(relativePath)) {
        throw new DevsyncError(
          `Secret repository entries must be regular files, not symlinks: ${relativePath}`,
        );
      }

      await readPlainSnapshotNode(absolutePath, relativePath, config, snapshot);
      continue;
    }

    if (isSecretArtifactPath(relativePath)) {
      const repoPath = stripSecretArtifactSuffix(relativePath);

      if (repoPath === undefined || repoPath.length === 0) {
        throw new DevsyncError(
          `Secret repository files must include a path before ${relativePath}`,
        );
      }

      assertStorageSafeRepoPath(repoPath);
      const mode = resolveManagedSyncMode(config, repoPath);

      if (findOwningSyncEntry(config, repoPath) === undefined) {
        throw new DevsyncError(
          `Unmanaged secret sync path found in repository: ${repoPath}`,
        );
      }

      if (mode === "ignore") {
        continue;
      }

      if (mode !== "secret") {
        throw new DevsyncError(
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
      continue;
    }

    if (!stats.isFile()) {
      throw new DevsyncError(
        `Unsupported plain repository entry: ${absolutePath}`,
      );
    }

    await readPlainSnapshotNode(absolutePath, relativePath, config, snapshot);
  }
};

export const buildRepositorySnapshot = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
) => {
  const snapshot = new Map<string, SnapshotNode>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);

  await readRepositoryTree(artifactsDirectory, config, snapshot);

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const artifactPath = join(artifactsDirectory, ...entry.repoPath.split("/"));
    const stats = await getPathStats(artifactPath);

    if (stats !== undefined && !stats.isDirectory()) {
      throw new DevsyncError(
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
