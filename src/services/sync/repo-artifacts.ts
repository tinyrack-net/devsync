import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  type ResolvedSyncConfig,
  resolveSyncPlainDirectoryPath,
  resolveSyncSecretDirectoryPath,
} from "#app/config/sync.ts";

import { encryptSecretFile } from "./crypto.ts";
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
  return artifact.kind === "directory"
    ? `${artifact.category}:${artifact.repoPath}/`
    : `${artifact.category}:${artifact.repoPath}`;
};

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ResolvedSyncConfig,
) => {
  const artifacts: RepoArtifact[] = [];

  for (const repoPath of [...snapshot.keys()].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    const node = snapshot.get(repoPath);

    if (node === undefined) {
      continue;
    }

    if (node.type === "directory") {
      artifacts.push({
        category: "plain",
        kind: "directory",
        repoPath,
      });
      continue;
    }

    if (node.type === "symlink") {
      artifacts.push({
        category: "plain",
        kind: "symlink",
        linkTarget: node.linkTarget,
        repoPath,
      });
      continue;
    }

    if (!node.secret) {
      artifacts.push({
        category: "plain",
        contents: node.contents,
        executable: node.executable,
        kind: "file",
        repoPath,
      });
      continue;
    }

    artifacts.push({
      category: "secret",
      contents: await encryptSecretFile(node.contents, config.age.recipients),
      executable: node.executable,
      kind: "file",
      repoPath,
    });
  }

  return artifacts;
};

const collectArtifactLeafKeys = async (
  rootDirectory: string,
  category: "plain" | "secret",
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
      await collectArtifactLeafKeys(absolutePath, category, keys, relativePath);
      continue;
    }

    if (category === "secret") {
      if (relativePath.endsWith(".age")) {
        keys.add(`${category}:${relativePath.slice(0, -".age".length)}`);
      } else {
        keys.add(`${category}:${relativePath}`);
      }

      continue;
    }

    keys.add(`${category}:${relativePath}`);
  }
};

export const collectExistingArtifactKeys = async (
  syncDirectory: string,
  config: ResolvedSyncConfig,
) => {
  const keys = new Set<string>();
  const plainDirectory = resolveSyncPlainDirectoryPath(syncDirectory);
  const secretDirectory = resolveSyncSecretDirectoryPath(syncDirectory);

  await collectArtifactLeafKeys(plainDirectory, "plain", keys);
  await collectArtifactLeafKeys(secretDirectory, "secret", keys);

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const path = join(plainDirectory, ...entry.repoPath.split("/"));
    const stats = await getPathStats(path);

    if (stats?.isDirectory()) {
      keys.add(`plain:${buildDirectoryKey(entry.repoPath)}`);
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
    const artifactPath = join(rootDirectory, ...artifact.repoPath.split("/"));

    if (artifact.kind === "directory") {
      await mkdir(artifactPath, { recursive: true });
      continue;
    }

    if (artifact.kind === "symlink") {
      await writeSymlinkNode(artifactPath, artifact.linkTarget);
      continue;
    }

    const targetPath =
      artifact.category === "secret" ? `${artifactPath}.age` : artifactPath;

    await writeFileNode(targetPath, artifact);
  }
};
