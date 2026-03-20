import { basename, dirname, join, posix } from "node:path";

import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveSyncMode,
} from "#app/config/sync.ts";
import { SyncError } from "./error.ts";
import type { FilesystemPort } from "./filesystem.ts";
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

const resolveManagedSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  const mode = resolveSyncMode(config, repoPath);

  if (mode === undefined) {
    throw new SyncError(`Unmanaged sync path found during pull: ${repoPath}`);
  }

  return mode;
};

const copyIgnoredLocalNodesToDirectory = async (
  sourceDirectory: string,
  targetDirectory: string,
  config: ResolvedSyncConfig,
  repoPathPrefix: string,
  filesystem: Pick<
    FilesystemPort,
    | "copyFilesystemNode"
    | "getPathStats"
    | "listDirectoryEntries"
    | "lstat"
    | "mkdir"
  >,
): Promise<number> => {
  const stats = await filesystem.getPathStats(sourceDirectory);

  if (stats === undefined || !stats.isDirectory()) {
    return 0;
  }

  let copiedNodeCount = 0;
  const entries = await filesystem.listDirectoryEntries(sourceDirectory);
  const directoryMode = resolveManagedSyncMode(config, repoPathPrefix);

  if (directoryMode === "ignore") {
    await filesystem.mkdir(targetDirectory, { recursive: true });
    copiedNodeCount += 1;
  }

  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);
    const repoPath = posix.join(repoPathPrefix, entry.name);
    const entryStats = await filesystem.lstat(sourcePath);

    if (entryStats.isDirectory()) {
      copiedNodeCount += await copyIgnoredLocalNodesToDirectory(
        sourcePath,
        targetPath,
        config,
        repoPath,
        filesystem,
      );
      continue;
    }

    if (resolveManagedSyncMode(config, repoPath) !== "ignore") {
      continue;
    }

    await filesystem.mkdir(dirname(targetPath), { recursive: true });
    await filesystem.copyFilesystemNode(sourcePath, targetPath, entryStats);
    copiedNodeCount += 1;
  }

  return copiedNodeCount;
};

const stageAndReplaceFilePath = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
  filesystem: Pick<
    FilesystemPort,
    | "mkdir"
    | "mkdtemp"
    | "replacePathAtomically"
    | "rm"
    | "symlink"
    | "writeFileNode"
  >,
) => {
  await filesystem.mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await filesystem.mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devsync-sync-`),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    if (node.type === "symlink") {
      await filesystem.symlink(node.linkTarget, stagedPath);
    } else {
      await filesystem.writeFileNode(stagedPath, node);
    }

    await filesystem.replacePathAtomically(targetPath, stagedPath);
  } finally {
    await filesystem.rm(stagingDirectory, { force: true, recursive: true });
  }
};

const stageAndReplaceMergedDirectoryPath = async (
  entry: ResolvedSyncConfigEntry,
  config: ResolvedSyncConfig,
  desiredNodes: ReadonlyMap<string, FileLikeSnapshotNode>,
  filesystem: Pick<
    FilesystemPort,
    | "copyFilesystemNode"
    | "getPathStats"
    | "listDirectoryEntries"
    | "lstat"
    | "mkdir"
    | "mkdtemp"
    | "removePathAtomically"
    | "replacePathAtomically"
    | "rm"
    | "writeFileNode"
    | "writeSymlinkNode"
  >,
) => {
  await filesystem.mkdir(dirname(entry.localPath), { recursive: true });
  const stagingDirectory = await filesystem.mkdtemp(
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
      filesystem,
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
        await filesystem.writeSymlinkNode(targetNodePath, node.linkTarget);
      } else {
        await filesystem.writeFileNode(targetNodePath, node);
      }
    }

    if (preservedIgnoredNodeCount === 0 && desiredNodes.size === 0) {
      await filesystem.removePathAtomically(entry.localPath);

      return;
    }

    await filesystem.replacePathAtomically(entry.localPath, stagingDirectory);
  } finally {
    await filesystem.rm(stagingDirectory, { force: true, recursive: true });
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
      throw new SyncError(
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
    throw new SyncError(
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
  filesystem: Pick<
    FilesystemPort,
    "getPathStats" | "listDirectoryEntries" | "lstat"
  >,
  prefix?: string,
) => {
  const stats = await filesystem.getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (!stats.isDirectory()) {
    keys.add(repoPathPrefix);

    return;
  }

  keys.add(buildDirectoryKey(repoPathPrefix));

  const entries = await filesystem.listDirectoryEntries(targetPath);

  for (const entry of entries) {
    const absolutePath = join(targetPath, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const childStats = await filesystem.lstat(absolutePath);

    if (childStats?.isDirectory()) {
      await collectLocalLeafKeys(
        absolutePath,
        repoPathPrefix,
        keys,
        filesystem,
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
  filesystem: Pick<FilesystemPort, "getPathStats" | "listDirectoryEntries">,
): Promise<boolean> => {
  const stats = await filesystem.getPathStats(targetPath);

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
  const entries = await filesystem.listDirectoryEntries(targetPath);

  for (const entry of entries) {
    const childPath = join(targetPath, entry.name);
    const childRepoPath = posix.join(repoPath, entry.name);

    preservedIgnoredChildren =
      (await collectIgnoredLocalKeys(
        childPath,
        childRepoPath,
        config,
        keys,
        filesystem,
      )) || preservedIgnoredChildren;
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
  filesystem: Pick<
    FilesystemPort,
    "getPathStats" | "listDirectoryEntries" | "lstat"
  >,
) => {
  const existingKeys = new Set<string>();
  const preservedIgnoredKeys = new Set<string>();

  await collectLocalLeafKeys(
    entry.localPath,
    entry.repoPath,
    existingKeys,
    filesystem,
  );
  await collectIgnoredLocalKeys(
    entry.localPath,
    entry.repoPath,
    config,
    preservedIgnoredKeys,
    filesystem,
  );

  return [...existingKeys].filter((key) => {
    return !desiredKeys.has(key) && !preservedIgnoredKeys.has(key);
  }).length;
};

export const applyEntryMaterialization = async (
  entry: ResolvedSyncConfigEntry,
  materialization: EntryMaterialization,
  config: ResolvedSyncConfig,
  filesystem: Pick<
    FilesystemPort,
    | "copyFilesystemNode"
    | "getPathStats"
    | "listDirectoryEntries"
    | "lstat"
    | "mkdir"
    | "mkdtemp"
    | "removePathAtomically"
    | "replacePathAtomically"
    | "rm"
    | "symlink"
    | "writeFileNode"
    | "writeSymlinkNode"
  >,
) => {
  if (
    entry.kind === "file" &&
    resolveManagedSyncMode(config, entry.repoPath) === "ignore"
  ) {
    return;
  }

  if (materialization.type === "absent") {
    if (entry.kind === "directory") {
      await stageAndReplaceMergedDirectoryPath(
        entry,
        config,
        new Map(),
        filesystem,
      );

      return;
    }

    await filesystem.removePathAtomically(entry.localPath);

    return;
  }

  if (materialization.type === "file") {
    await stageAndReplaceFilePath(
      entry.localPath,
      materialization.node,
      filesystem,
    );

    return;
  }

  await stageAndReplaceMergedDirectoryPath(
    entry,
    config,
    materialization.nodes,
    filesystem,
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
