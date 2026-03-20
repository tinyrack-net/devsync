import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncMode,
} from "#app/config/sync.ts";

import type { CryptoPort } from "./crypto.ts";
import { SyncError } from "./error.ts";
import type { FilesystemPort } from "./filesystem.ts";
import { addSnapshotNode, type SnapshotNode } from "./local-snapshot.ts";
import {
  assertStorageSafeRepoPath,
  isSecretArtifactPath,
  stripSecretArtifactSuffix,
} from "./repo-artifacts.ts";

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
  filesystem: Pick<
    FilesystemPort,
    "isExecutableMode" | "lstat" | "readFile" | "readlink"
  >,
) => {
  assertStorageSafeRepoPath(repoPath);
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

  const stats = await filesystem.lstat(absolutePath);

  if (stats.isSymbolicLink()) {
    addSnapshotNode(snapshot, repoPath, {
      linkTarget: await filesystem.readlink(absolutePath),
      type: "symlink",
    });

    return;
  }

  if (!stats.isFile()) {
    throw new SyncError(`Unsupported plain repository entry: ${absolutePath}`);
  }

  addSnapshotNode(snapshot, repoPath, {
    contents: await filesystem.readFile(absolutePath),
    executable: filesystem.isExecutableMode(stats.mode),
    secret: false,
    type: "file",
  });
};

const readRepositoryTree = async (
  rootDirectory: string,
  config: ResolvedSyncConfig,
  snapshot: Map<string, SnapshotNode>,
  dependencies: Readonly<{
    crypto: Pick<CryptoPort, "decryptSecretFile">;
    filesystem: Pick<
      FilesystemPort,
      | "isExecutableMode"
      | "listDirectoryEntries"
      | "lstat"
      | "pathExists"
      | "readFile"
      | "readlink"
    >;
  }>,
  prefix?: string,
) => {
  if (!(await dependencies.filesystem.pathExists(rootDirectory))) {
    return;
  }

  const entries =
    await dependencies.filesystem.listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await dependencies.filesystem.lstat(absolutePath);

    if (stats.isDirectory()) {
      assertStorageSafeRepoPath(relativePath);
      await readRepositoryTree(
        absolutePath,
        config,
        snapshot,
        dependencies,
        relativePath,
      );
      continue;
    }

    if (stats.isSymbolicLink()) {
      if (isSecretArtifactPath(relativePath)) {
        throw new SyncError(
          `Secret repository entries must be regular files, not symlinks: ${relativePath}`,
        );
      }

      await readPlainSnapshotNode(
        absolutePath,
        relativePath,
        config,
        snapshot,
        dependencies.filesystem,
      );
      continue;
    }

    if (isSecretArtifactPath(relativePath)) {
      const repoPath = stripSecretArtifactSuffix(relativePath);

      if (repoPath === undefined || repoPath.length === 0) {
        throw new SyncError(
          `Secret repository files must include a path before ${relativePath}`,
        );
      }

      assertStorageSafeRepoPath(repoPath);
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
        contents: await dependencies.crypto.decryptSecretFile(
          await dependencies.filesystem.readFile(absolutePath, "utf8"),
          config.age.identityFile,
        ),
        executable: dependencies.filesystem.isExecutableMode(stats.mode),
        secret: true,
        type: "file",
      });
      continue;
    }

    if (!stats.isFile()) {
      throw new SyncError(
        `Unsupported plain repository entry: ${absolutePath}`,
      );
    }

    await readPlainSnapshotNode(
      absolutePath,
      relativePath,
      config,
      snapshot,
      dependencies.filesystem,
    );
  }
};

export const buildRepositorySnapshot = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
  dependencies: Readonly<{
    crypto: Pick<CryptoPort, "decryptSecretFile">;
    filesystem: Pick<
      FilesystemPort,
      | "getPathStats"
      | "isExecutableMode"
      | "listDirectoryEntries"
      | "lstat"
      | "pathExists"
      | "readFile"
      | "readlink"
    >;
  }>,
) => {
  const snapshot = new Map<string, SnapshotNode>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);

  await readRepositoryTree(artifactsDirectory, config, snapshot, dependencies);

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const artifactPath = join(artifactsDirectory, ...entry.repoPath.split("/"));
    const stats = await dependencies.filesystem.getPathStats(artifactPath);

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
