import { realpathSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CONSTANTS } from "#app/config/constants.ts";
import {
  type ResolvedSyncConfigEntry,
  resolveSyncRule,
} from "#app/config/sync.ts";
import {
  fileContentsEqual,
  shouldNormalizeTextLineEndings,
} from "#app/lib/content.ts";
import {
  buildExecutableMode,
  buildSearchableDirectoryMode,
  supportsPosixFileModes,
} from "#app/lib/file-mode.ts";
import {
  createSymlink,
  getFollowedPathStats,
  getPathStats,
  removePathAtomically,
  replacePathAtomically,
  writeFileNode,
} from "#app/lib/filesystem.ts";
import {
  buildDirectoryKey,
  normalizeLinkTargetForComparison,
} from "#app/lib/path.ts";
import { limitConcurrency } from "#app/lib/promise.ts";
import type { FileLikeSnapshotNode } from "./local-snapshot.ts";
import {
  collectDeletableLocalKeys,
  countDeletedLocalNodes,
} from "./materialization-diff.ts";
import type { EntryMaterialization } from "./materialization-plan.ts";
import { buildDesiredDirectoryKeys } from "./materialization-plan.ts";
import type { ProfiledSyncConfig } from "./runtime.ts";

export const materializedDirectoryModeMatches = (
  actualMode: number,
  fileMode?: number,
) => {
  if (!supportsPosixFileModes()) {
    return true;
  }

  const maskedActualMode = actualMode & 0o777;

  if (fileMode === undefined) {
    const ownerAndSearchMask = 0o711;
    return (maskedActualMode & ownerAndSearchMask) === ownerAndSearchMask;
  }

  return maskedActualMode === (buildSearchableDirectoryMode(fileMode) & 0o777);
};

export const materializedFileModeMatches = (
  actualMode: number,
  executable: boolean,
  fileMode?: number,
) => {
  if (!supportsPosixFileModes()) {
    return true;
  }

  const expectedMode = (fileMode ?? buildExecutableMode(executable)) & 0o777;
  const maskedActualMode = actualMode & 0o777;

  if (maskedActualMode === expectedMode) {
    return true;
  }

  if (fileMode === undefined) {
    const ownerAndExecMask = 0o711;
    return (
      (maskedActualMode & ownerAndExecMask) ===
      (expectedMode & ownerAndExecMask)
    );
  }

  return false;
};

export const isMaterializedFileLikeNodeCurrent = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
  fileMode?: number,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return false;
  }

  if (node.type === "symlink") {
    if (!stats.isSymbolicLink()) {
      return false;
    }

    const currentLinkTarget = await readlink(targetPath);

    return (
      normalizeLinkTargetForComparison(
        currentLinkTarget,
        dirname(targetPath),
      ) ===
      normalizeLinkTargetForComparison(node.linkTarget, dirname(targetPath))
    );
  }

  if (!stats.isFile()) {
    return false;
  }

  const currentContents = await readFile(targetPath);

  return (
    fileContentsEqual(node.contents, currentContents, {
      normalizeTextLineEndings: shouldNormalizeTextLineEndings(),
    }) && materializedFileModeMatches(stats.mode, node.executable, fileMode)
  );
};

export const resolveStagingParentDirectory = (targetPath: string) => {
  const parentDirectory = dirname(targetPath);

  if (process.platform !== "win32") {
    return parentDirectory;
  }

  try {
    return realpathSync.native(parentDirectory);
  } catch {
    return parentDirectory;
  }
};

export const stageAndReplaceFilePath = async (
  targetPath: string,
  node: FileLikeSnapshotNode,
  fileMode?: number,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(
      resolveStagingParentDirectory(targetPath),
      `.${basename(targetPath)}.dotweave-sync-`,
    ),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    if (node.type === "symlink") {
      await createSymlink(node.linkTarget, stagedPath);
    } else {
      await writeFileNode(stagedPath, node, fileMode);
    }

    await replacePathAtomically(targetPath, stagedPath);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};

export const stageAndReplaceDirectoryPath = async (
  targetPath: string,
  fileMode?: number,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(
      resolveStagingParentDirectory(targetPath),
      `.${basename(targetPath)}.dotweave-sync-`,
    ),
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

export const ensureMaterializedDirectoryPath = async (
  targetPath: string,
  fileMode?: number,
) => {
  const stats = await getFollowedPathStats(targetPath);

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

export const reconcileMaterializedDirectoryPath = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
  desiredNodes: ReadonlyMap<string, FileLikeSnapshotNode>,
  config: ProfiledSyncConfig,
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

  await limitConcurrency(
    CONSTANTS.SYNC.DEFAULT_CONCURRENCY,
    [...desiredDirectoryKeys].sort((left, right) => {
      return left.localeCompare(right);
    }),
    async (directoryKey) => {
      if (directoryKey === desiredRootKey) {
        return;
      }

      const relativePath = directoryKey.slice(entry.repoPath.length + 1, -1);
      await ensureMaterializedDirectoryPath(
        join(entry.localPath, ...relativePath.split("/")),
        fileMode,
      );
    },
  );

  await limitConcurrency(
    CONSTANTS.SYNC.DEFAULT_CONCURRENCY,
    [...desiredNodes.keys()].sort((left, right) => {
      return left.localeCompare(right);
    }),
    async (relativePath) => {
      const node = desiredNodes.get(relativePath);

      if (node === undefined) {
        return;
      }

      const targetNodePath = join(entry.localPath, ...relativePath.split("/"));

      if (
        await isMaterializedFileLikeNodeCurrent(targetNodePath, node, fileMode)
      ) {
        return;
      }

      await stageAndReplaceFilePath(targetNodePath, node, fileMode);
    },
  );

  const existingKeys = new Set<string>();
  const keyToLocalPath = new Map<string, string>();
  await countDeletedLocalNodes(
    entry,
    desiredKeys,
    config,
    existingKeys,
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
  }
};

export const applyEntryMaterialization = async (
  entry: ResolvedSyncConfigEntry,
  materialization: EntryMaterialization,
  config: ProfiledSyncConfig,
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
      entry.permission,
    );

    return;
  }

  await reconcileMaterializedDirectoryPath(
    entry,
    materialization.desiredKeys,
    materialization.nodes,
    config,
    entry.permission,
  );
};
