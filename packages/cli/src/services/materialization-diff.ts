import { join, posix } from "node:path";
import {
  collectChildEntryPaths,
  type ResolvedSyncConfigEntry,
  resolveSyncRule,
} from "#app/config/sync.ts";
import {
  getFollowedPathStats,
  getPathStats,
  listDirectoryEntries,
} from "#app/lib/filesystem.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import {
  isMaterializedFileLikeNodeCurrent,
  materializedDirectoryModeMatches,
} from "./materialization-apply.ts";
import type { EntryMaterialization } from "./materialization-plan.ts";
import type { ProfiledSyncConfig } from "./runtime.ts";

export const collectLocalLeafKeys = async (
  targetPath: string,
  repoPathPrefix: string,
  keys: Set<string>,
  keyToLocalPath: Map<string, string> | undefined,
  childEntryPaths: ReadonlySet<string>,
  prefix?: string,
  providedStats?: Awaited<ReturnType<typeof getPathStats>>,
) => {
  const stats = providedStats ?? (await getPathStats(targetPath));

  if (stats === undefined) {
    return;
  }

  if (!stats.isDirectory()) {
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
    const childStats = await getPathStats(absolutePath);
    const repoPath = posix.join(repoPathPrefix, relativePath);

    if (childStats === undefined) {
      continue;
    }

    if (childEntryPaths.has(repoPath)) {
      continue;
    }

    if (childStats?.isDirectory()) {
      await collectLocalLeafKeys(
        absolutePath,
        repoPathPrefix,
        keys,
        keyToLocalPath,
        childEntryPaths,
        relativePath,
      );
      continue;
    }

    keys.add(repoPath);
    keyToLocalPath?.set(repoPath, absolutePath);
  }
};

export const buildLocalPathDepth = (localPath: string) => {
  return localPath.split(/[/\\]+/u).length;
};

export const collectDeletableLocalKeys = async (
  existingKeys: ReadonlySet<string>,
  desiredKeys: ReadonlySet<string>,
  keyToLocalPath: ReadonlyMap<string, string>,
) => {
  const deletableKeys: string[] = [];
  const scheduledLocalPaths = new Set<string>();

  const isWindows = process.platform === "win32";
  const desiredKeysForComparison = isWindows
    ? new Set([...desiredKeys].map((key) => key.toLowerCase()))
    : desiredKeys;

  const staleKeys = [...existingKeys]
    .filter((key) => {
      return isWindows
        ? !desiredKeysForComparison.has(key.toLowerCase())
        : !desiredKeysForComparison.has(key);
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

export const countDeletedLocalNodes = async (
  entry: ResolvedSyncConfigEntry,
  desiredKeys: ReadonlySet<string>,
  config: ProfiledSyncConfig,
  existingKeys: Set<string> = new Set<string>(),
  keyToLocalPath?: Map<string, string>,
  deletedKeys?: Set<string>,
) => {
  const rule = resolveSyncRule(config, entry.repoPath, config.activeProfile);

  if (rule === undefined || rule.mode === "ignore") {
    return 0;
  }

  const childEntryPaths =
    entry.kind === "directory"
      ? collectChildEntryPaths(config, entry.repoPath)
      : new Set<string>();

  const rootStats =
    entry.kind === "directory"
      ? await getFollowedPathStats(entry.localPath)
      : await getPathStats(entry.localPath);

  await collectLocalLeafKeys(
    entry.localPath,
    entry.repoPath,
    existingKeys,
    keyToLocalPath,
    childEntryPaths,
    undefined,
    rootStats,
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
  config?: ProfiledSyncConfig,
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
  const rootStats = await getFollowedPathStats(entry.localPath);

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
