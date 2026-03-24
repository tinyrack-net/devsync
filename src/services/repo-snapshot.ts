import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import {
  resolveManagedSyncMode,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncRule,
} from "#app/config/sync.js";
import { isExecutableMode } from "#app/lib/file-mode.js";
import { decryptSecretFile } from "./crypto.js";
import { DevsyncError, wrapUnknownError } from "./error.js";
import { getPathStats, listDirectoryEntries } from "./filesystem.js";
import { addSnapshotNode, type SnapshotNode } from "./local-snapshot.js";
import {
  assertStorageSafeRepoPath,
  collectArtifactNamespaces,
  parseArtifactRelativePath,
} from "./repo-artifacts.js";
import type { EffectiveSyncConfig } from "./runtime.js";

type RepositorySnapshotConfig = EffectiveSyncConfig;

const isActiveStorageProfile = (
  storageProfile: string,
  config: RepositorySnapshotConfig,
  repoPath: string,
) => {
  const rule = resolveSyncRule(config, repoPath, config.activeProfile);

  if (rule === undefined) {
    return false;
  }

  return rule.profile === storageProfile;
};

const readArtifactLeaf = async (
  absolutePath: string,
  storagePath: string,
  config: RepositorySnapshotConfig,
  snapshot: Map<string, SnapshotNode>,
) => {
  const artifact = parseArtifactRelativePath(storagePath);

  if (!isActiveStorageProfile(artifact.profile, config, artifact.repoPath)) {
    return;
  }

  assertStorageSafeRepoPath(artifact.repoPath);
  const rule = resolveSyncRule(config, artifact.repoPath, config.activeProfile);

  if (rule === undefined) {
    throw new DevsyncError(
      "Repository path is not managed by the current sync configuration.",
      {
        code: "UNMANAGED_SYNC_PATH",
        details: [
          `Repository path: ${artifact.repoPath}`,
          `Context: ${storagePath}`,
        ],
        hint: "Add the parent path to devsync, or remove stray artifacts from the sync repository.",
      },
    );
  }

  if (rule.profile !== artifact.profile) {
    throw new DevsyncError(
      "Repository artifact is stored under the wrong profile namespace.",
      {
        code: "REPO_PROFILE_MISMATCH",
        details: [
          `Repository path: ${artifact.repoPath}`,
          `Stored profile: ${artifact.profile}`,
          `Expected profile: ${rule.profile}`,
        ],
      },
    );
  }

  if (artifact.secret) {
    if (rule.mode !== "secret") {
      throw new DevsyncError(
        "Plain sync path is stored as a secret artifact in the repository.",
        {
          code: "PLAIN_STORED_SECRET",
          details: [`Repository path: ${storagePath}`],
        },
      );
    }

    const stats = await lstat(absolutePath);

    if (!stats.isFile()) {
      throw new DevsyncError(
        "Secret repository artifacts must be regular files, not symlinks.",
        {
          code: "SECRET_ARTIFACT_SYMLINK",
          details: [`Repository path: ${storagePath}`],
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
            `Repository path: ${storagePath}`,
            `Identity file: ${config.age.identityFile}`,
          ],
        },
      );
    }

    addSnapshotNode(snapshot, artifact.repoPath, {
      contents,
      executable: isExecutableMode(stats.mode),
      secret: true,
      type: "file",
    });

    return;
  }

  const mode = resolveManagedSyncMode(
    config,
    artifact.repoPath,
    config.activeProfile,
    storagePath,
  );
  const stats = await lstat(absolutePath);

  if (stats.isSymbolicLink()) {
    if (mode === "secret") {
      throw new DevsyncError(
        "Secret sync path is stored as a plain artifact in the repository.",
        {
          code: "SECRET_STORED_PLAIN",
          details: [`Repository path: ${storagePath}`],
        },
      );
    }

    addSnapshotNode(snapshot, artifact.repoPath, {
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
        details: [`Repository path: ${storagePath}`],
      },
    );
  }

  if (mode === "secret") {
    throw new DevsyncError(
      "Secret sync path is stored as a plain artifact in the repository.",
      {
        code: "SECRET_STORED_PLAIN",
        details: [`Repository path: ${storagePath}`],
      },
    );
  }

  addSnapshotNode(snapshot, artifact.repoPath, {
    contents: await readFile(absolutePath),
    executable: isExecutableMode(stats.mode),
    secret: false,
    type: "file",
  });
};

const walkArtifactTree = async (
  rootDirectory: string,
  config: RepositorySnapshotConfig,
  snapshot: Map<string, SnapshotNode>,
  prefix = "",
) => {
  const entries = await listDirectoryEntries(rootDirectory);

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const storagePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats.isDirectory()) {
      await walkArtifactTree(absolutePath, config, snapshot, storagePath);
      continue;
    }

    await readArtifactLeaf(absolutePath, storagePath, config, snapshot);
  }
};

export const buildRepositorySnapshot = async (
  syncDirectory: string,
  config: RepositorySnapshotConfig,
) => {
  const snapshot = new Map<string, SnapshotNode>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const namespaces = collectArtifactNamespaces(config.entries);

  await Promise.all(
    [...namespaces].map(async (namespace) => {
      const namespaceDirectory = join(artifactsDirectory, namespace);
      const namespaceStats = await getPathStats(namespaceDirectory);

      if (namespaceStats?.isDirectory()) {
        await walkArtifactTree(namespaceDirectory, config, snapshot, namespace);
      }
    }),
  );

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const rule = resolveSyncRule(config, entry.repoPath, config.activeProfile);

    if (rule === undefined) {
      continue;
    }

    const hasTrackedChildren = [...snapshot.keys()].some((repoPath) => {
      return repoPath.startsWith(`${entry.repoPath}/`);
    });
    const expectedPath = join(
      artifactsDirectory,
      rule.profile,
      ...entry.repoPath.split("/"),
    );
    const expectedStats = await getPathStats(expectedPath);

    if (expectedStats !== undefined && !expectedStats.isDirectory()) {
      throw new DevsyncError(
        "Directory sync entry is not stored as a directory in the repository.",
        {
          code: "DIRECTORY_ENTRY_NOT_DIRECTORY",
          details: [`Repository path: ${entry.repoPath}`],
        },
      );
    }

    if (
      (expectedStats?.isDirectory() ?? false) &&
      (rule.mode !== "ignore" || hasTrackedChildren)
    ) {
      addSnapshotNode(snapshot, entry.repoPath, { type: "directory" });
    }
  }

  return snapshot;
};
