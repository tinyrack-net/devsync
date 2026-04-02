import { chmod, lstat, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import type { ConsolaInstance } from "consola";
import {
  collectChildEntryPaths,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveManagedSyncMode,
  resolveSyncRule,
} from "#app/config/sync.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { buildSearchableDirectoryMode } from "#app/lib/file-mode.ts";
import {
  copyFilesystemNode,
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
  replacePathAtomically,
  writeFileNode,
  writeSymlinkNode,
} from "#app/lib/filesystem.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import type { FileLikeSnapshotNode, SnapshotNode } from "./local-snapshot.ts";

type MaterializationConfig = ResolvedSyncConfig &
  Readonly<{
    activeProfile?: string;
  }>;

const reportPullPlanningProgress = (
  reporter: ConsolaInstance | undefined,
  state: { scannedLocalNodeCount: number },
  repoPath: string,
) => {
  state.scannedLocalNodeCount += 1;

  if ((reporter?.level ?? 0) >= 4) {
    reporter?.verbose(`scanned local path ${repoPath} while planning pull`);
    return;
  }

  if (state.scannedLocalNodeCount % 100 === 0) {
    reporter?.start(
      `Scanned ${state.scannedLocalNodeCount} local paths while planning pull...`,
    );
  }
};

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
  config: MaterializationConfig,
  repoPathPrefix: string,
  reporter?: ConsolaInstance,
): Promise<number> => {
  const stats = await getPathStats(sourceDirectory);

  if (stats === undefined || !stats.isDirectory()) {
    return 0;
  }

  let copiedNodeCount = 0;
  const entries = await listDirectoryEntries(sourceDirectory);
  const directoryMode = resolveManagedSyncMode(
    config,
    repoPathPrefix,
    config.activeProfile,
  );

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
        reporter,
      );
      continue;
    }

    if (
      resolveManagedSyncMode(config, repoPath, config.activeProfile) !==
      "ignore"
    ) {
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await copyFilesystemNode(sourcePath, targetPath, entryStats);
    reporter?.verbose(`preserved ignored local path ${repoPath}`);
    copiedNodeCount += 1;
  }

  return copiedNodeCount;
};

const stageAndReplaceFilePath = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
  reporter?: ConsolaInstance,
  fileMode?: number,
) => {
  reporter?.verbose(`staging local file ${targetPath}`);
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devsync-sync-`),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    if (node.type === "symlink") {
      await symlink(node.linkTarget, stagedPath);
    } else {
      await writeFileNode(stagedPath, node, fileMode);
    }

    await replacePathAtomically(targetPath, stagedPath);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

const stageAndReplaceMergedDirectoryPath = async (
  entry: ResolvedSyncConfigEntry,
  config: MaterializationConfig,
  desiredNodes: ReadonlyMap<string, FileLikeSnapshotNode>,
  reporter?: ConsolaInstance,
  fileMode?: number,
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
      reporter,
    );
    let stagedNodeCount = 0;

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
        await writeFileNode(targetNodePath, node, fileMode);
      }

      stagedNodeCount += 1;

      if ((reporter?.level ?? 0) >= 4) {
        reporter?.verbose(
          `staged local node ${posix.join(entry.repoPath, relativePath)}`,
        );
      } else if (stagedNodeCount % 100 === 0) {
        reporter?.start(
          `Staged ${stagedNodeCount} local nodes for ${entry.repoPath}...`,
        );
      }
    }

    if (preservedIgnoredNodeCount === 0 && desiredNodes.size === 0) {
      await removePathAtomically(entry.localPath);

      return;
    }

    if (fileMode !== undefined) {
      await chmod(stagingDirectory, buildSearchableDirectoryMode(fileMode));
    }

    await replacePathAtomically(entry.localPath, stagingDirectory);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

export const buildEntryMaterialization = (
  entry: ResolvedSyncConfigEntry,
  snapshot: ReadonlyMap<string, SnapshotNode>,
  reporter?: ConsolaInstance,
): EntryMaterialization => {
  if (entry.kind === "file") {
    const node = snapshot.get(entry.repoPath);

    if (node === undefined) {
      reporter?.verbose(`planned an absent local file ${entry.repoPath}`);
      return {
        desiredKeys: new Set<string>(),
        type: "absent",
      };
    }

    if (node.type === "directory") {
      throw new DevsyncError(
        "File sync entry resolves to a directory in the repository.",
        {
          code: "FILE_ENTRY_RESOLVES_DIRECTORY",
          details: [`Repository path: ${entry.repoPath}`],
          hint: "Run 'devsync push' or fix the repository so this path is stored as a file.",
        },
      );
    }

    reporter?.verbose(`planned a local file ${entry.repoPath}`);
    return {
      desiredKeys: new Set<string>([entry.repoPath]),
      node,
      type: "file",
    };
  }

  const rootNode = snapshot.get(entry.repoPath);

  if (rootNode !== undefined && rootNode.type !== "directory") {
    throw new DevsyncError(
      "Directory sync entry resolves to a file in the repository.",
      {
        code: "DIRECTORY_ENTRY_RESOLVES_FILE",
        details: [`Repository path: ${entry.repoPath}`],
        hint: "Run 'devsync push' or fix the repository so this path is stored as a directory.",
      },
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
    reporter?.verbose(`planned an absent local directory ${entry.repoPath}`);
    return {
      desiredKeys,
      type: "absent",
    };
  }

  desiredKeys.add(buildDirectoryKey(entry.repoPath));
  reporter?.verbose(`planned a local directory ${entry.repoPath}`);

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
  childEntryPaths: ReadonlySet<string>,
  prefix?: string,
  reporter?: ConsolaInstance,
  progressState: { scannedLocalNodeCount: number } = {
    scannedLocalNodeCount: 0,
  },
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (!stats.isDirectory()) {
    reportPullPlanningProgress(reporter, progressState, repoPathPrefix);
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
    const repoPath = posix.join(repoPathPrefix, relativePath);

    if (childEntryPaths.has(repoPath)) {
      continue;
    }

    reportPullPlanningProgress(reporter, progressState, repoPath);

    if (childStats?.isDirectory()) {
      await collectLocalLeafKeys(
        absolutePath,
        repoPathPrefix,
        keys,
        childEntryPaths,
        relativePath,
        reporter,
        progressState,
      );
      continue;
    }

    keys.add(repoPath);
  }
};

export const countDeletedLocalNodes = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
  config: MaterializationConfig,
  existingKeys: Set<string> = new Set<string>(),
  reporter?: ConsolaInstance,
) => {
  const rule = resolveSyncRule(config, entry.repoPath, config.activeProfile);

  if (rule === undefined || rule.mode === "ignore") {
    return 0;
  }

  const progressState = { scannedLocalNodeCount: 0 };
  const childEntryPaths =
    entry.kind === "directory"
      ? collectChildEntryPaths(config, entry.repoPath)
      : new Set<string>();

  await collectLocalLeafKeys(
    entry.localPath,
    entry.repoPath,
    existingKeys,
    childEntryPaths,
    undefined,
    reporter,
    progressState,
  );

  return [...existingKeys].filter((key) => {
    return !desiredKeys.has(key);
  }).length;
};

export const applyEntryMaterialization = async (
  entry: ResolvedSyncConfigEntry,
  materialization: EntryMaterialization,
  config: MaterializationConfig,
  reporter?: ConsolaInstance,
) => {
  const rule = resolveSyncRule(config, entry.repoPath, config.activeProfile);

  if (rule === undefined || rule.mode === "ignore") {
    return;
  }

  if (materialization.type === "absent") {
    if (entry.kind === "directory") {
      await stageAndReplaceMergedDirectoryPath(
        entry,
        config,
        new Map(),
        reporter,
        entry.permission,
      );

      return;
    }

    await removePathAtomically(entry.localPath);

    return;
  }

  if (materialization.type === "file") {
    await stageAndReplaceFilePath(
      entry.localPath,
      materialization.node,
      reporter,
      entry.permission,
    );

    return;
  }

  await stageAndReplaceMergedDirectoryPath(
    entry,
    config,
    materialization.nodes,
    reporter,
    entry.permission,
  );
};

export const buildPullCounts = (
  materializations: readonly (EntryMaterialization | undefined)[],
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
