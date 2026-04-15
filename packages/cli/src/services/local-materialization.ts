import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import type { ConsolaInstance } from "consola";
import {
  collectChildEntryPaths,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveSyncRule,
} from "#app/config/sync.ts";
import { DevsyncError } from "#app/lib/error.ts";
import {
  buildExecutableMode,
  buildSearchableDirectoryMode,
  supportsPosixFileModes,
} from "#app/lib/file-mode.ts";
import {
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
  replacePathAtomically,
  writeFileNode,
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

export type EntryMaterialization =
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

const materializedDirectoryModeMatches = (
  actualMode: number,
  fileMode?: number,
) => {
  if (!supportsPosixFileModes()) {
    return true;
  }

  if (fileMode === undefined) {
    return true;
  }

  return (
    (actualMode & 0o777) === (buildSearchableDirectoryMode(fileMode) & 0o777)
  );
};

const materializedFileModeMatches = (
  actualMode: number,
  executable: boolean,
  fileMode?: number,
) => {
  if (!supportsPosixFileModes()) {
    return true;
  }

  return (
    (actualMode & 0o777) ===
    ((fileMode ?? buildExecutableMode(executable)) & 0o777)
  );
};

const isMaterializedFileLikeNodeCurrent = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
  fileMode?: number,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return false;
  }

  if (node.type === "symlink") {
    const currentLinkTarget = await readlink(targetPath);

    return (
      stats.isSymbolicLink() &&
      normalizeLinkTargetForComparison(currentLinkTarget) ===
        normalizeLinkTargetForComparison(node.linkTarget)
    );
  }

  if (!stats.isFile()) {
    return false;
  }

  const currentContents = await readFile(targetPath);

  return (
    Buffer.compare(Buffer.from(node.contents), currentContents) === 0 &&
    materializedFileModeMatches(stats.mode, node.executable, fileMode)
  );
};

const normalizeLinkTargetForComparison = (target: string) => {
  return process.platform === "win32" ? target.replaceAll("\\", "/") : target;
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

const stageAndReplaceDirectoryPath = async (
  targetPath: string,
  fileMode?: number,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devsync-sync-`),
  );

  try {
    if (fileMode !== undefined) {
      await chmod(stagingDirectory, buildSearchableDirectoryMode(fileMode));
    }

    await replacePathAtomically(targetPath, stagingDirectory);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

const ensureMaterializedDirectoryPath = async (
  targetPath: string,
  fileMode?: number,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    await mkdir(targetPath, { recursive: true });

    if (fileMode !== undefined) {
      await chmod(targetPath, buildSearchableDirectoryMode(fileMode));
    }

    return;
  }

  if (!stats.isDirectory()) {
    await stageAndReplaceDirectoryPath(targetPath, fileMode);
    return;
  }

  if (
    fileMode !== undefined &&
    !materializedDirectoryModeMatches(stats.mode, fileMode)
  ) {
    await chmod(targetPath, buildSearchableDirectoryMode(fileMode));
  }
};

const buildDesiredDirectoryKeys = (
  entry: ResolvedSyncConfigEntry,
  desiredNodes: ReadonlyMap<string, FileLikeSnapshotNode>,
) => {
  const desiredDirectoryKeys = new Set<string>([
    buildDirectoryKey(entry.repoPath),
  ]);

  for (const relativePath of desiredNodes.keys()) {
    const segments = relativePath.split("/");

    for (let index = 1; index < segments.length; index += 1) {
      desiredDirectoryKeys.add(
        buildDirectoryKey(
          posix.join(entry.repoPath, ...segments.slice(0, index)),
        ),
      );
    }
  }

  return desiredDirectoryKeys;
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
  keyToLocalPath: Map<string, string> | undefined,
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
    keyToLocalPath?.set(repoPathPrefix, targetPath);

    return;
  }

  const currentRepoPath =
    prefix === undefined ? repoPathPrefix : posix.join(repoPathPrefix, prefix);
  const directoryKey = buildDirectoryKey(currentRepoPath);
  keys.add(directoryKey);
  keyToLocalPath?.set(directoryKey, targetPath);

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
        keyToLocalPath,
        childEntryPaths,
        relativePath,
        reporter,
        progressState,
      );
      continue;
    }

    keys.add(repoPath);
    keyToLocalPath?.set(repoPath, absolutePath);
  }
};

const buildLocalPathDepth = (localPath: string) => {
  return localPath.split(/[/\\]+/u).length;
};

const collectDeletableLocalKeys = async (
  existingKeys: ReadonlySet<string>,
  desiredKeys: ReadonlySet<string>,
  keyToLocalPath: ReadonlyMap<string, string>,
) => {
  const deletableKeys: string[] = [];
  const scheduledLocalPaths = new Set<string>();
  const staleKeys = [...existingKeys]
    .filter((key) => {
      return !desiredKeys.has(key);
    })
    .sort((left, right) => {
      const leftPath = keyToLocalPath.get(left) ?? "";
      const rightPath = keyToLocalPath.get(right) ?? "";
      return (
        buildLocalPathDepth(rightPath) - buildLocalPathDepth(leftPath) ||
        rightPath.localeCompare(leftPath)
      );
    });

  for (const key of staleKeys) {
    const localPath = keyToLocalPath.get(key);

    if (localPath === undefined) {
      continue;
    }

    const stats = await getPathStats(localPath);

    if (stats === undefined) {
      continue;
    }

    if (!stats.isDirectory()) {
      deletableKeys.push(key);
      scheduledLocalPaths.add(localPath);
      continue;
    }

    const entries = await listDirectoryEntries(localPath);
    const canDeleteDirectory = entries.every((entry) => {
      return scheduledLocalPaths.has(join(localPath, entry.name));
    });

    if (!canDeleteDirectory) {
      continue;
    }

    deletableKeys.push(key);
    scheduledLocalPaths.add(localPath);
  }

  return deletableKeys;
};

const reconcileMaterializedDirectoryPath = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
  desiredNodes: ReadonlyMap<string, FileLikeSnapshotNode>,
  config: MaterializationConfig,
  reporter?: ConsolaInstance,
  fileMode?: number,
) => {
  const desiredRootKey = buildDirectoryKey(entry.repoPath);
  const desiredRootExists = desiredKeys.has(desiredRootKey);

  if (desiredRootExists) {
    await ensureMaterializedDirectoryPath(entry.localPath, fileMode);
  }

  const desiredDirectoryKeys = desiredRootExists
    ? buildDesiredDirectoryKeys(entry, desiredNodes)
    : new Set<string>();

  for (const directoryKey of [...desiredDirectoryKeys].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    if (directoryKey === desiredRootKey) {
      continue;
    }

    const relativePath = directoryKey.slice(entry.repoPath.length + 1, -1);
    await ensureMaterializedDirectoryPath(
      join(entry.localPath, ...relativePath.split("/")),
      fileMode,
    );
  }

  let processedNodeCount = 0;

  for (const relativePath of [...desiredNodes.keys()].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    const node = desiredNodes.get(relativePath);

    if (node === undefined) {
      continue;
    }

    const targetNodePath = join(entry.localPath, ...relativePath.split("/"));

    if (
      await isMaterializedFileLikeNodeCurrent(targetNodePath, node, fileMode)
    ) {
      continue;
    }

    await stageAndReplaceFilePath(targetNodePath, node, reporter, fileMode);
    processedNodeCount += 1;

    if ((reporter?.level ?? 0) >= 4) {
      reporter?.verbose(
        `updated local node ${posix.join(entry.repoPath, relativePath)}`,
      );
    } else if (processedNodeCount % 100 === 0) {
      reporter?.start(
        `Updated ${processedNodeCount} local nodes for ${entry.repoPath}...`,
      );
    }
  }

  const existingKeys = new Set<string>();
  const keyToLocalPath = new Map<string, string>();
  await countDeletedLocalNodes(
    entry,
    desiredKeys,
    config,
    existingKeys,
    reporter,
    keyToLocalPath,
  );

  const deletableKeys = await collectDeletableLocalKeys(
    existingKeys,
    desiredKeys,
    keyToLocalPath,
  );

  for (const key of deletableKeys) {
    const localPath = keyToLocalPath.get(key);

    if (localPath === undefined) {
      continue;
    }

    await removePathAtomically(localPath);
    reporter?.verbose(`removed stale local path ${key}`);
  }
};

export const countDeletedLocalNodes = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
  config: MaterializationConfig,
  existingKeys: Set<string> = new Set<string>(),
  reporter?: ConsolaInstance,
  keyToLocalPath?: Map<string, string>,
  deletedKeys?: Set<string>,
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
    keyToLocalPath,
    childEntryPaths,
    undefined,
    reporter,
    progressState,
  );

  const deletableKeys = await collectDeletableLocalKeys(
    existingKeys,
    desiredKeys,
    keyToLocalPath ?? new Map<string, string>(),
  );

  for (const key of deletableKeys) {
    deletedKeys?.add(key);
  }

  return deletableKeys.length;
};

export const collectChangedLocalPaths = async (
  entry: ResolvedSyncConfigEntry,
  materialization: EntryMaterialization,
  config?: MaterializationConfig,
) => {
  if (materialization.type === "absent") {
    if (config === undefined) {
      return [];
    }

    const existingKeys = new Set<string>();
    const keyToLocalPath = new Map<string, string>();
    const deletedKeys = new Set<string>();
    await countDeletedLocalNodes(
      entry,
      materialization.desiredKeys,
      config,
      existingKeys,
      undefined,
      keyToLocalPath,
      deletedKeys,
    );

    return [...deletedKeys]
      .map((key) => {
        return keyToLocalPath.get(key);
      })
      .filter((path): path is string => {
        return path !== undefined;
      })
      .sort((left, right) => {
        return left.localeCompare(right);
      });
  }

  if (materialization.type === "file") {
    return (await isMaterializedFileLikeNodeCurrent(
      entry.localPath,
      materialization.node,
      entry.permission,
    ))
      ? []
      : [entry.localPath];
  }

  const changedLocalPaths: string[] = [];
  const rootStats = await getPathStats(entry.localPath);

  if (rootStats === undefined || !rootStats.isDirectory()) {
    changedLocalPaths.push(entry.localPath);
  } else if (
    !materializedDirectoryModeMatches(rootStats.mode, entry.permission)
  ) {
    changedLocalPaths.push(entry.localPath);
  }

  for (const relativePath of [...materialization.nodes.keys()].sort(
    (left, right) => {
      return left.localeCompare(right);
    },
  )) {
    const node = materialization.nodes.get(relativePath);

    if (node === undefined) {
      continue;
    }

    const targetPath = join(entry.localPath, ...relativePath.split("/"));

    if (
      !(await isMaterializedFileLikeNodeCurrent(
        targetPath,
        node,
        entry.permission,
      ))
    ) {
      changedLocalPaths.push(targetPath);
    }
  }

  if (config !== undefined) {
    const existingKeys = new Set<string>();
    const keyToLocalPath = new Map<string, string>();
    const deletedKeys = new Set<string>();
    await countDeletedLocalNodes(
      entry,
      materialization.desiredKeys,
      config,
      existingKeys,
      undefined,
      keyToLocalPath,
      deletedKeys,
    );

    for (const key of deletedKeys) {
      const localPath = keyToLocalPath.get(key);

      if (localPath !== undefined) {
        changedLocalPaths.push(localPath);
      }
    }
  }

  return [...new Set(changedLocalPaths)].sort((left, right) => {
    return left.localeCompare(right);
  });
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
      await reconcileMaterializedDirectoryPath(
        entry,
        materialization.desiredKeys,
        new Map(),
        config,
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

  await reconcileMaterializedDirectoryPath(
    entry,
    materialization.desiredKeys,
    materialization.nodes,
    config,
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
