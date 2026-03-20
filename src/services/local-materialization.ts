import { lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";

import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveManagedSyncMode,
} from "#app/config/sync.ts";
import { DevsyncError } from "./error.ts";
import {
  copyFilesystemNode,
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
  replacePathAtomically,
  writeFileNode,
  writeSymlinkNode,
} from "./filesystem.ts";
import type { FileLikeSnapshotNode, SnapshotNode } from "./local-snapshot.ts";
import { buildDirectoryKey } from "./paths.ts";

type EntryMaterialization =
  | Readonly<{
      desiredKeys: ReadonlySet<string>;
      type: "absent";
    }>
  | Readonly<{
      desiredKeys: ReadonlySet<string>;
      node: FileLikeSnapshotNode;
      type: "file";
    }>
  | Readonly<{
      desiredKeys: ReadonlySet<string>;
      nodes: ReadonlyMap<string, FileLikeSnapshotNode>;
      type: "directory";
    }>;

const copyIgnoredLocalNodesToDirectory = async (
  sourceDirectory: string,
  targetDirectory: string,
  config: ResolvedSyncConfig,
  repoPathPrefix: string,
): Promise<number> => {
  const stats = await getPathStats(sourceDirectory);

  if (stats === undefined || !stats.isDirectory()) {
    return 0;
  }

  let copiedNodeCount = 0;
  const entries = await listDirectoryEntries(sourceDirectory);
  const directoryMode = resolveManagedSyncMode(config, repoPathPrefix);

  if (directoryMode === "ignore") {
    await mkdir(targetDirectory, { recursive: true });
    copiedNodeCount += 1;
  }

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);
    const repoPath = posix.join(repoPathPrefix, entry.name);
    const entryStats = await lstat(sourcePath);

    if (entryStats.isDirectory()) {
      copiedNodeCount += await copyIgnoredLocalNodesToDirectory(
        sourcePath,
        targetPath,
        config,
        repoPath,
      );
      continue;
    }

    if (resolveManagedSyncMode(config, repoPath) !== "ignore") {
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFilesystemNode(sourcePath, targetPath, entryStats);
    copiedNodeCount += 1;
  }

  return copiedNodeCount;
};

const stageAndReplaceFilePath = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devsync-sync-`),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    if (node.type === "symlink") {
      await symlink(node.linkTarget, stagedPath);
    } else {
      await writeFileNode(stagedPath, node);
    }

    await replacePathAtomically(targetPath, stagedPath);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

const stageAndReplaceMergedDirectoryPath = async (
  entry: ResolvedSyncConfigEntry,
  config: ResolvedSyncConfig,
  desiredNodes: ReadonlyMap<string, FileLikeSnapshotNode>,
) => {
  await mkdir(dirname(entry.localPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(
      dirname(entry.localPath),
      `.${basename(entry.localPath)}.devsync-sync-`,
    ),
  );

  try {
    const preservedIgnoredNodeCount = await copyIgnoredLocalNodesToDirectory(
      entry.localPath,
      stagingDirectory,
      config,
      entry.repoPath,
    );

    for (const relativePath of [...desiredNodes.keys()].sort((left, right) => {
      return left.localeCompare(right);
    })) {
      const node = desiredNodes.get(relativePath);

      if (node === undefined) {
        continue;
      }

      const targetNodePath = join(stagingDirectory, ...relativePath.split("/"));

      if (node.type === "symlink") {
        await writeSymlinkNode(targetNodePath, node.linkTarget);
      } else {
        await writeFileNode(targetNodePath, node);
      }
    }

    if (preservedIgnoredNodeCount === 0 && desiredNodes.size === 0) {
      await removePathAtomically(entry.localPath);

      return;
    }

    await replacePathAtomically(entry.localPath, stagingDirectory);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

export const buildEntryMaterialization = (
  entry: ResolvedSyncConfigEntry,
  snapshot: ReadonlyMap<string, SnapshotNode>,
): EntryMaterialization => {
  if (entry.kind === "file") {
    const node = snapshot.get(entry.repoPath);

    if (node === undefined) {
      return {
        desiredKeys: new Set<string>(),
        type: "absent",
      };
    }

    if (node.type === "directory") {
      throw new DevsyncError(
        `File sync entry resolves to a directory in the repository: ${entry.repoPath}`,
      );
    }

    return {
      desiredKeys: new Set<string>([entry.repoPath]),
      node,
      type: "file",
    };
  }

  const rootNode = snapshot.get(entry.repoPath);

  if (rootNode !== undefined && rootNode.type !== "directory") {
    throw new DevsyncError(
      `Directory sync entry resolves to a file in the repository: ${entry.repoPath}`,
    );
  }

  const nodes = new Map<string, FileLikeSnapshotNode>();
  const desiredKeys = new Set<string>();

  for (const [repoPath, node] of snapshot.entries()) {
    if (!repoPath.startsWith(`${entry.repoPath}/`)) {
      continue;
    }

    if (node.type === "directory") {
      continue;
    }

    const relativePath = repoPath.slice(entry.repoPath.length + 1);

    nodes.set(relativePath, node);
    desiredKeys.add(repoPath);
  }

  if (rootNode === undefined && nodes.size === 0) {
    return {
      desiredKeys,
      type: "absent",
    };
  }

  desiredKeys.add(buildDirectoryKey(entry.repoPath));

  return {
    desiredKeys,
    nodes,
    type: "directory",
  };
};

const collectLocalLeafKeys = async (
  targetPath: string,
  repoPathPrefix: string,
  keys: Set<string>,
  prefix?: string,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (!stats.isDirectory()) {
    keys.add(repoPathPrefix);

    return;
  }

  keys.add(buildDirectoryKey(repoPathPrefix));

  const entries = await listDirectoryEntries(targetPath);

  for (const entry of entries) {
    const absolutePath = join(targetPath, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const childStats = await lstat(absolutePath);

    if (childStats?.isDirectory()) {
      await collectLocalLeafKeys(
        absolutePath,
        repoPathPrefix,
        keys,
        relativePath,
      );
      continue;
    }

    keys.add(posix.join(repoPathPrefix, relativePath));
  }
};

const collectIgnoredLocalKeys = async (
  targetPath: string,
  repoPath: string,
  config: ResolvedSyncConfig,
  keys: Set<string>,
): Promise<boolean> => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return false;
  }

  const mode = resolveManagedSyncMode(config, repoPath);

  if (!stats.isDirectory()) {
    if (mode !== "ignore") {
      return false;
    }

    keys.add(repoPath);

    return true;
  }

  let preservedIgnoredChildren = mode === "ignore";
  const entries = await listDirectoryEntries(targetPath);

  for (const entry of entries) {
    const childPath = join(targetPath, entry.name);
    const childRepoPath = posix.join(repoPath, entry.name);

    preservedIgnoredChildren =
      (await collectIgnoredLocalKeys(childPath, childRepoPath, config, keys)) ||
      preservedIgnoredChildren;
  }

  if (mode === "ignore" || preservedIgnoredChildren) {
    keys.add(buildDirectoryKey(repoPath));
  }

  return mode === "ignore" || preservedIgnoredChildren;
};

export const countDeletedLocalNodes = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
  config: ResolvedSyncConfig,
) => {
  const existingKeys = new Set<string>();
  const preservedIgnoredKeys = new Set<string>();

  await collectLocalLeafKeys(entry.localPath, entry.repoPath, existingKeys);
  await collectIgnoredLocalKeys(
    entry.localPath,
    entry.repoPath,
    config,
    preservedIgnoredKeys,
  );

  return [...existingKeys].filter((key) => {
    return !desiredKeys.has(key) && !preservedIgnoredKeys.has(key);
  }).length;
};

export const applyEntryMaterialization = async (
  entry: ResolvedSyncConfigEntry,
  materialization: EntryMaterialization,
  config: ResolvedSyncConfig,
) => {
  if (
    entry.kind === "file" &&
    resolveManagedSyncMode(config, entry.repoPath) === "ignore"
  ) {
    return;
  }

  if (materialization.type === "absent") {
    if (entry.kind === "directory") {
      await stageAndReplaceMergedDirectoryPath(entry, config, new Map());

      return;
    }

    await removePathAtomically(entry.localPath);

    return;
  }

  if (materialization.type === "file") {
    await stageAndReplaceFilePath(entry.localPath, materialization.node);

    return;
  }

  await stageAndReplaceMergedDirectoryPath(
    entry,
    config,
    materialization.nodes,
  );
};

export const buildPullCounts = (
  materializations: readonly EntryMaterialization[],
) => {
  let decryptedFileCount = 0;
  let directoryCount = 0;
  let plainFileCount = 0;
  let symlinkCount = 0;

  for (const materialization of materializations) {
    if (materialization === undefined) {
      continue;
    }

    if (materialization.type === "file") {
      if (materialization.node.type === "symlink") {
        symlinkCount += 1;
      } else if (materialization.node.secret) {
        decryptedFileCount += 1;
      } else {
        plainFileCount += 1;
      }

      continue;
    }

    if (materialization.type !== "directory") {
      continue;
    }

    directoryCount += 1;

    for (const node of materialization.nodes.values()) {
      if (node.type === "symlink") {
        symlinkCount += 1;
      } else if (node.secret) {
        decryptedFileCount += 1;
      } else {
        plainFileCount += 1;
      }
    }
  }

  return {
    decryptedFileCount,
    directoryCount,
    plainFileCount,
    symlinkCount,
  };
};
