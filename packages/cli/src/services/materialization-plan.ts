import { posix } from "node:path";
import {
  findOwningSyncEntry,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
} from "#app/config/sync.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import type { FileLikeSnapshotNode, SnapshotNode } from "./local-snapshot.ts";

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

export const buildDesiredDirectoryKeys = (
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
  config: Pick<ResolvedSyncConfig, "entries">,
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
      throw new DotweaveError(
        "File sync entry resolves to a directory in the repository.",
        {
          code: "FILE_ENTRY_RESOLVES_DIRECTORY",
          details: [`Repository path: ${entry.repoPath}`],
          hint: "Run 'dotweave push' or fix the repository so this path is stored as a file.",
        },
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
    throw new DotweaveError(
      "Directory sync entry resolves to a file in the repository.",
      {
        code: "DIRECTORY_ENTRY_RESOLVES_FILE",
        details: [`Repository path: ${entry.repoPath}`],
        hint: "Run 'dotweave push' or fix the repository so this path is stored as a directory.",
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

    if (findOwningSyncEntry(config, repoPath) !== entry) {
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
