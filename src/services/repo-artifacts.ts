import { lstat, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  findOwningSyncEntry,
  hasReservedSyncArtifactSuffixSegment,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncRule,
  syncSecretArtifactSuffix,
} from "#app/config/sync.ts";

import { encryptSecretFile } from "./crypto.ts";
import { DevsyncError } from "./error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  writeFileNode,
  writeSymlinkNode,
} from "./filesystem.ts";
import type { SnapshotNode } from "./local-snapshot.ts";
import { buildDirectoryKey } from "./paths.ts";

type ArtifactConfig = ResolvedSyncConfig &
  Readonly<{
    activeProfile?: string;
  }>;

export const syncDefaultArtifactNamespace = "default";

export type RepoArtifact =
  | Readonly<{
      category: "plain";
      kind: "directory";
      profile?: string;
      repoPath: string;
    }>
  | Readonly<{
      category: "plain";
      kind: "file";
      repoPath: string;
      profile?: string;
      contents: Uint8Array;
      executable: boolean;
    }>
  | Readonly<{
      category: "plain";
      kind: "symlink";
      profile?: string;
      repoPath: string;
      linkTarget: string;
    }>
  | Readonly<{
      category: "secret";
      kind: "file";
      profile?: string;
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
    `Tracked sync paths must not use the reserved suffix ${syncSecretArtifactSuffix}.`,
    {
      code: "RESERVED_SECRET_SUFFIX",
      details: [`Repository path: ${repoPath}`],
      hint: "Rename the tracked path so no segment ends with the secret artifact suffix.",
    },
  );
};

export const resolveArtifactRelativePath = (
  artifact: Pick<RepoArtifact, "category" | "profile" | "repoPath">,
) => {
  const namespace = artifact.profile ?? syncDefaultArtifactNamespace;
  const profileRelativePath = `${namespace}/${artifact.repoPath}`;

  return artifact.category === "secret"
    ? `${profileRelativePath}${syncSecretArtifactSuffix}`
    : profileRelativePath;
};

export const parseArtifactRelativePath = (relativePath: string) => {
  const secret = relativePath.endsWith(syncSecretArtifactSuffix);
  const logicalPath = secret
    ? relativePath.slice(0, -syncSecretArtifactSuffix.length)
    : relativePath;
  const [namespace, ...segments] = logicalPath.split("/");

  if (namespace === undefined || segments.length === 0) {
    throw new DevsyncError("Repository artifact path is invalid.", {
      code: "INVALID_REPO_ENTRY",
      details: [`Repository path: ${relativePath}`],
    });
  }

  return {
    profile: namespace === syncDefaultArtifactNamespace ? undefined : namespace,
    repoPath: segments.join("/"),
    secret,
  };
};

export const resolveEntryArtifactRelativePath = (
  entry: Pick<ResolvedSyncConfigEntry, "profile" | "repoPath">,
) => {
  return resolveArtifactRelativePath({
    category: "plain",
    profile: entry.profile,
    repoPath: entry.repoPath,
  });
};

export const resolveEntryArtifactPath = (
  artifactsDirectory: string,
  entry: Pick<ResolvedSyncConfigEntry, "profile" | "repoPath">,
) => {
  return join(
    artifactsDirectory,
    ...resolveEntryArtifactRelativePath(entry).split("/"),
  );
};

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ArtifactConfig,
) => {
  const artifacts: RepoArtifact[] = [];
  const seenArtifactKeys = new Set<string>();

  for (const repoPath of [...snapshot.keys()].sort((left, right) => {
    return left.localeCompare(right);
  })) {
    assertStorageSafeRepoPath(repoPath);
    const node = snapshot.get(repoPath);
    const owningEntry = findOwningSyncEntry(config, repoPath);
    const resolvedRule = resolveSyncRule(
      config,
      repoPath,
      config.activeProfile,
    );

    if (
      node === undefined ||
      owningEntry === undefined ||
      resolvedRule === undefined
    ) {
      continue;
    }

    if (node.type === "directory") {
      const artifact = {
        category: "plain",
        kind: "directory",
        profile: resolvedRule.profile,
        repoPath,
      } satisfies RepoArtifact;
      const key = buildArtifactKey(artifact);

      if (seenArtifactKeys.has(key)) {
        throw new DevsyncError("Duplicate repository artifact was generated.", {
          code: "DUPLICATE_REPO_ARTIFACT",
          details: [`Artifact key: ${key}`],
        });
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
        profile: resolvedRule.profile,
        repoPath,
      } satisfies RepoArtifact;
      const key = buildArtifactKey(artifact);

      if (seenArtifactKeys.has(key)) {
        throw new DevsyncError("Duplicate repository artifact was generated.", {
          code: "DUPLICATE_REPO_ARTIFACT",
          details: [`Artifact key: ${key}`],
        });
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
        profile: resolvedRule.profile,
        repoPath,
      } satisfies RepoArtifact;
      const key = buildArtifactKey(artifact);

      if (seenArtifactKeys.has(key)) {
        throw new DevsyncError("Duplicate repository artifact was generated.", {
          code: "DUPLICATE_REPO_ARTIFACT",
          details: [`Artifact key: ${key}`],
        });
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
      profile: resolvedRule.profile,
      repoPath,
    } satisfies RepoArtifact;
    const key = buildArtifactKey(artifact);

    if (seenArtifactKeys.has(key)) {
      throw new DevsyncError("Duplicate repository artifact was generated.", {
        code: "DUPLICATE_REPO_ARTIFACT",
        details: [`Artifact key: ${key}`],
      });
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
  const rootStats = await getPathStats(rootDirectory);

  if (rootStats === undefined) {
    return;
  }

  if (!rootStats.isDirectory()) {
    if (prefix !== undefined) {
      keys.add(prefix);
    }

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
  config: ArtifactConfig,
) => {
  const keys = new Set<string>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);

  await collectArtifactLeafKeys(artifactsDirectory, keys);

  for (const key of [...keys]) {
    if (key.startsWith("__dir__:")) {
      continue;
    }

    const artifact = parseArtifactRelativePath(key);
    const rule = resolveSyncRule(
      config,
      artifact.repoPath,
      config.activeProfile,
    );

    if (rule === undefined || rule.profile !== artifact.profile) {
      keys.delete(key);
    }
  }

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const rule = resolveSyncRule(config, entry.repoPath, config.activeProfile);

    if (rule === undefined) {
      continue;
    }

    const relativePath = resolveArtifactRelativePath({
      category: "plain",
      profile: rule.profile,
      repoPath: entry.repoPath,
    });
    const path = join(artifactsDirectory, ...relativePath.split("/"));

    if ((await getPathStats(path))?.isDirectory()) {
      keys.add(buildDirectoryKey(relativePath));
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
