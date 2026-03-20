import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import {
  findOwningSyncEntry,
  type ResolvedSyncConfig,
  resolveManagedSyncMode,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";

import { decryptSecretFile } from "./crypto.ts";
import { DevsyncError, wrapUnknownError } from "./error.ts";
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
      "Repository contains a plain artifact for an unmanaged path.",
      {
        code: "UNMANAGED_SYNC_PATH",
        details: [`Repository path: ${repoPath}`],
        hint: "Remove the stray artifact or add the path to devsync.",
      },
    );
  }

  if (mode === "secret") {
    throw new DevsyncError(
      "Secret sync path is stored as a plain artifact in the repository.",
      {
        code: "SECRET_STORED_PLAIN",
        details: [`Repository path: ${repoPath}`],
        hint: "Run 'devsync push' after fixing the secret rule so the repository artifact is re-encrypted.",
      },
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
      "Repository contains an unsupported plain artifact type.",
      {
        code: "UNSUPPORTED_REPO_ENTRY",
        details: [`Repository path: ${repoPath}`],
        hint: "Keep plain repository artifacts as regular files or symlinks only.",
      },
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
          "Secret repository artifacts must be regular files, not symlinks.",
          {
            code: "SECRET_ARTIFACT_SYMLINK",
            details: [`Repository path: ${relativePath}`],
            hint: "Replace the symlink with an encrypted regular file by re-running 'devsync push'.",
          },
        );
      }

      await readPlainSnapshotNode(absolutePath, relativePath, config, snapshot);
      continue;
    }

    if (isSecretArtifactPath(relativePath)) {
      const repoPath = stripSecretArtifactSuffix(relativePath);

      if (repoPath === undefined || repoPath.length === 0) {
        throw new DevsyncError("Secret repository artifact path is invalid.", {
          code: "INVALID_SECRET_ARTIFACT_PATH",
          details: [`Repository path: ${relativePath}`],
          hint: "Secret artifacts must be stored as '<path>.devsync.secret'.",
        });
      }

      assertStorageSafeRepoPath(repoPath);
      const mode = resolveManagedSyncMode(config, repoPath);

      if (findOwningSyncEntry(config, repoPath) === undefined) {
        throw new DevsyncError(
          "Repository contains a secret artifact for an unmanaged path.",
          {
            code: "UNMANAGED_SYNC_PATH",
            details: [`Repository path: ${repoPath}`],
            hint: "Remove the stray artifact or add the path to devsync.",
          },
        );
      }

      if (mode === "ignore") {
        continue;
      }

      if (mode !== "secret") {
        throw new DevsyncError(
          "Plain sync path is stored as a secret artifact in the repository.",
          {
            code: "PLAIN_STORED_SECRET",
            details: [`Repository path: ${repoPath}`],
            hint: "Update the sync rule or run 'devsync push' so the repository storage matches the configured mode.",
          },
        );
      }

      let contents: Uint8Array;

      try {
        contents = await decryptSecretFile(
          await readFile(absolutePath, "utf8"),
          config.age.identityFile,
        );
      } catch (error: unknown) {
        throw wrapUnknownError(
          "Failed to decrypt a secret repository artifact.",
          error,
          {
            code: "SECRET_ARTIFACT_DECRYPT_FAILED",
            details: [
              `Repository path: ${relativePath}`,
              `Identity file: ${config.age.identityFile}`,
            ],
            hint: "Check that the artifact is valid age data and that the configured identity file can decrypt it.",
          },
        );
      }

      addSnapshotNode(snapshot, repoPath, {
        contents,
        executable: isExecutableMode(stats.mode),
        secret: true,
        type: "file",
      });
      continue;
    }

    if (!stats.isFile()) {
      throw new DevsyncError(
        "Repository contains an unsupported plain artifact type.",
        {
          code: "UNSUPPORTED_REPO_ENTRY",
          details: [`Repository path: ${relativePath}`],
          hint: "Keep plain repository artifacts as regular files or symlinks only.",
        },
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
        "Directory sync entry is not stored as a directory in the repository.",
        {
          code: "DIRECTORY_ENTRY_NOT_DIRECTORY",
          details: [`Repository path: ${entry.repoPath}`],
          hint: "Run 'devsync push' to recreate the repository directory structure.",
        },
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
