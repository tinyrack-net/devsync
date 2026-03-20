import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  hasReservedSyncArtifactSuffixSegment,
  type ResolvedSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  syncSecretArtifactSuffix,
} from "#app/config/sync.ts";

import { encryptSecretFile } from "./crypto.ts";
import { DevsyncError } from "./error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  pathExists,
  writeFileNode,
  writeSymlinkNode,
} from "./filesystem.ts";
import type { SnapshotNode } from "./local-snapshot.ts";
import { buildDirectoryKey } from "./paths.ts";

export type RepoArtifact =
  | Readonly<{
      category: "plain";
      kind: "directory";
      repoPath: string;
    }>
  | Readonly<{
      category: "plain";
      kind: "file";
      repoPath: string;
      contents: Uint8Array;
      executable: boolean;
    }>
  | Readonly<{
      category: "plain";
      kind: "symlink";
      repoPath: string;
      linkTarget: string;
    }>
  | Readonly<{
      category: "secret";
      kind: "file";
      repoPath: string;
      contents: string;
      executable: boolean;
    }>;

export const buildArtifactKey = (artifact: RepoArtifact) => {
  const relativePath = resolveArtifactRelativePath(artifact);

  return artifact.kind === "directory"
    ? buildDirectoryKey(relativePath)
    : relativePath;
};

export const isSecretArtifactPath = (relativePath: string) => {
  return relativePath.endsWith(syncSecretArtifactSuffix);
};

export const stripSecretArtifactSuffix = (relativePath: string) => {
  if (!isSecretArtifactPath(relativePath)) {
    return undefined;
  }

  return relativePath.slice(0, -syncSecretArtifactSuffix.length);
};

export const assertStorageSafeRepoPath = (repoPath: string) => {
  if (!hasReservedSyncArtifactSuffixSegment(repoPath)) {
    return;
  }

  throw new DevsyncError(
    `Tracked sync paths must not use the reserved suffix ${syncSecretArtifactSuffix}: ${repoPath}`,
  );
};

export const resolveArtifactRelativePath = (
  artifact: Pick<RepoArtifact, "category" | "repoPath">,
) => {
  return artifact.category === "secret"
    ? `${artifact.repoPath}${syncSecretArtifactSuffix}`
    : artifact.repoPath;
};

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ResolvedSyncConfig,
) => {
  const artifacts: RepoArtifact[] = [];
  const seenArtifactKeys = new Set<string>();

  for (const repoPath of [...snapshot.keys()].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    assertStorageSafeRepoPath(repoPath);
    const node = snapshot.get(repoPath);

    if (node === undefined) {
      continue;
    }

    if (node.type === "directory") {
      const artifact = {
        category: "plain",
        kind: "directory",
        repoPath,
      } satisfies RepoArtifact;
      const key = buildArtifactKey(artifact);

      if (seenArtifactKeys.has(key)) {
        throw new DevsyncError(
          `Duplicate repository artifact generated for ${key}`,
        );
      }

      seenArtifactKeys.add(key);
      artifacts.push(artifact);
      continue;
    }

    if (node.type === "symlink") {
      const artifact = {
        category: "plain",
        kind: "symlink",
        linkTarget: node.linkTarget,
        repoPath,
      } satisfies RepoArtifact;
      const key = buildArtifactKey(artifact);

      if (seenArtifactKeys.has(key)) {
        throw new DevsyncError(
          `Duplicate repository artifact generated for ${key}`,
        );
      }

      seenArtifactKeys.add(key);
      artifacts.push(artifact);
      continue;
    }

    if (!node.secret) {
      const artifact = {
        category: "plain",
        contents: node.contents,
        executable: node.executable,
        kind: "file",
        repoPath,
      } satisfies RepoArtifact;
      const key = buildArtifactKey(artifact);

      if (seenArtifactKeys.has(key)) {
        throw new DevsyncError(
          `Duplicate repository artifact generated for ${key}`,
        );
      }

      seenArtifactKeys.add(key);
      artifacts.push(artifact);
      continue;
    }

    const artifact = {
      category: "secret",
      contents: await encryptSecretFile(node.contents, config.age.recipients),
      executable: node.executable,
      kind: "file",
      repoPath,
    } satisfies RepoArtifact;
    const key = buildArtifactKey(artifact);

    if (seenArtifactKeys.has(key)) {
      throw new DevsyncError(
        `Duplicate repository artifact generated for ${key}`,
      );
    }

    seenArtifactKeys.add(key);
    artifacts.push(artifact);
  }

  return artifacts;
};

const collectArtifactLeafKeys = async (
  rootDirectory: string,
  keys: Set<string>,
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

    if (stats?.isDirectory()) {
      await collectArtifactLeafKeys(absolutePath, keys, relativePath);
      continue;
    }

    keys.add(relativePath);
  }
};

export const collectExistingArtifactKeys = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
) => {
  const keys = new Set<string>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);

  await collectArtifactLeafKeys(artifactsDirectory, keys);

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const path = join(artifactsDirectory, ...entry.repoPath.split("/"));
    const stats = await getPathStats(path);

    if (stats?.isDirectory()) {
      keys.add(buildDirectoryKey(entry.repoPath));
    }
  }

  return keys;
};

export const writeArtifactsToDirectory = async (
  rootDirectory: string,
  artifacts: readonly RepoArtifact[],
) => {
  await mkdir(rootDirectory, { recursive: true });

  for (const artifact of artifacts) {
    const artifactPath = join(
      rootDirectory,
      ...resolveArtifactRelativePath(artifact).split("/"),
    );

    if (artifact.kind === "directory") {
      await mkdir(artifactPath, { recursive: true });
      continue;
    }

    if (artifact.kind === "symlink") {
      await writeSymlinkNode(artifactPath, artifact.linkTarget);
      continue;
    }

    await writeFileNode(artifactPath, artifact);
  }
};
