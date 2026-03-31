import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  findOwningSyncEntry,
  hasReservedSyncArtifactSuffixSegment,
  type ResolvedSyncConfigEntry,
  resolveSyncArtifactsDirectoryPath,
  resolveSyncRule,
  syncDefaultProfile,
  syncSecretArtifactSuffix,
} from "#app/config/sync.ts";
import { decryptSecretFile, encryptSecretFile } from "#app/lib/crypto.ts";
import { DevsyncError } from "#app/lib/error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  writeFileNode,
  writeSymlinkNode,
} from "#app/lib/filesystem.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import {
  type ProgressReporter,
  reportDetail,
  reportPhase,
} from "#app/lib/progress.ts";
import type { SnapshotNode } from "./local-snapshot.ts";
import type { EffectiveSyncConfig } from "./runtime.ts";

type ArtifactConfig = EffectiveSyncConfig;

const isActiveArtifactRule = (
  rule: ReturnType<typeof resolveSyncRule> | undefined,
  profile: string,
) => {
  return (
    rule !== undefined && rule.mode !== "ignore" && rule.profile === profile
  );
};

export const collectArtifactNamespaces = (
  entries: readonly Pick<ResolvedSyncConfigEntry, "profiles">[],
) => {
  const namespaces = new Set<string>();
  namespaces.add(syncDefaultProfile);

  for (const entry of entries) {
    for (const profile of entry.profiles) {
      namespaces.add(profile);
    }
  }

  return namespaces;
};

export type RepoArtifact =
  | Readonly<{
      category: "plain";
      kind: "directory";
      profile: string;
      repoPath: string;
    }>
  | Readonly<{
      category: "plain";
      kind: "file";
      repoPath: string;
      profile: string;
      contents: Uint8Array;
      executable: boolean;
    }>
  | Readonly<{
      category: "plain";
      kind: "symlink";
      profile: string;
      repoPath: string;
      linkTarget: string;
    }>
  | Readonly<{
      category: "secret";
      kind: "file";
      profile: string;
      repoPath: string;
      contents: Uint8Array;
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
  const profileRelativePath = `${artifact.profile}/${artifact.repoPath}`;

  return artifact.category === "secret"
    ? `${profileRelativePath}${syncSecretArtifactSuffix}`
    : profileRelativePath;
};

export const parseArtifactRelativePath = (relativePath: string) => {
  const secret = relativePath.endsWith(syncSecretArtifactSuffix);
  const logicalPath = secret
    ? relativePath.slice(0, -syncSecretArtifactSuffix.length)
    : relativePath;
  const segments = logicalPath.split("/");

  if (segments.length < 2 || segments[0] === undefined) {
    throw new DevsyncError("Repository artifact path is invalid.", {
      code: "INVALID_REPO_ENTRY",
      details: [`Repository path: ${relativePath}`],
    });
  }

  const [profile, ...repoPathSegments] = segments;

  return {
    profile,
    repoPath: repoPathSegments.join("/"),
    secret,
  };
};

export const resolveEntryArtifactRelativePath = (
  entry: Pick<ResolvedSyncConfigEntry, "repoPath">,
  profile: string,
) => {
  return resolveArtifactRelativePath({
    category: "plain",
    profile,
    repoPath: entry.repoPath,
  });
};

export const resolveEntryArtifactPath = (
  artifactsDirectory: string,
  entry: Pick<ResolvedSyncConfigEntry, "repoPath">,
  profile: string,
) => {
  return join(
    artifactsDirectory,
    ...resolveEntryArtifactRelativePath(entry, profile).split("/"),
  );
};

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ArtifactConfig,
  reporter?: ProgressReporter,
) => {
  const artifacts: RepoArtifact[] = [];
  const seenArtifactKeys = new Set<string>();
  let preparedArtifactCount = 0;

  const addArtifact = (artifact: RepoArtifact) => {
    const key = buildArtifactKey(artifact);

    if (seenArtifactKeys.has(key)) {
      throw new DevsyncError("Duplicate repository artifact was generated.", {
        code: "DUPLICATE_REPO_ARTIFACT",
        details: [`Artifact key: ${key}`],
      });
    }

    seenArtifactKeys.add(key);
    artifacts.push(artifact);
    preparedArtifactCount += 1;

    const relativePath = resolveArtifactRelativePath(artifact);

    if (reporter?.verbose) {
      reportDetail(reporter, `prepared repository artifact ${relativePath}`);
    } else if (preparedArtifactCount % 100 === 0) {
      reportPhase(
        reporter,
        `Prepared ${preparedArtifactCount} repository artifacts...`,
      );
    }
  };

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
      addArtifact({
        category: "plain",
        kind: "directory",
        profile: resolvedRule.profile,
        repoPath,
      });
      continue;
    }

    if (node.type === "symlink") {
      addArtifact({
        category: "plain",
        kind: "symlink",
        linkTarget: node.linkTarget,
        profile: resolvedRule.profile,
        repoPath,
      });
      continue;
    }

    if (!node.secret) {
      addArtifact({
        category: "plain",
        contents: node.contents,
        executable: node.executable,
        kind: "file",
        profile: resolvedRule.profile,
        repoPath,
      });
      continue;
    }

    addArtifact({
      category: "secret",
      contents: node.contents,
      executable: node.executable,
      kind: "file",
      profile: resolvedRule.profile,
      repoPath,
    });
  }

  return artifacts;
};

const collectArtifactLeafKeys = async (
  rootDirectory: string,
  keys: Set<string>,
  prefix?: string,
  onKey?: (key: string) => void,
) => {
  const rootStats = await getPathStats(rootDirectory);

  if (rootStats === undefined) {
    return;
  }

  if (!rootStats.isDirectory()) {
    if (prefix !== undefined) {
      keys.add(prefix);
      onKey?.(prefix);
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
      await collectArtifactLeafKeys(absolutePath, keys, relativePath, onKey);
      continue;
    }

    keys.add(relativePath);
    onKey?.(relativePath);
  }
};

export const collectExistingArtifactKeys = async (
  syncDirectory: string,
  config: ArtifactConfig,
  reporter?: ProgressReporter,
) => {
  const keys = new Set<string>();
  const artifactsDirectory = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const namespaces = collectArtifactNamespaces(config.entries);
  let discoveredArtifactCount = 0;

  const noteDiscoveredArtifact = (key: string) => {
    discoveredArtifactCount += 1;

    if (reporter?.verbose) {
      reportDetail(reporter, `found repository artifact ${key}`);
    } else if (discoveredArtifactCount % 100 === 0) {
      reportPhase(
        reporter,
        `Scanned ${discoveredArtifactCount} repository artifacts...`,
      );
    }
  };

  await Promise.all(
    [...namespaces].map(async (namespace) => {
      await collectArtifactLeafKeys(
        join(artifactsDirectory, namespace),
        keys,
        namespace,
        noteDiscoveredArtifact,
      );
    }),
  );

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

    if (!isActiveArtifactRule(rule, artifact.profile)) {
      keys.delete(key);
    }
  }

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const rule = resolveSyncRule(config, entry.repoPath, config.activeProfile);

    if (rule === undefined || rule.mode === "ignore") {
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

type AgeWriteConfig = Readonly<{
  identityFile: string;
  recipients: readonly string[];
}>;

const isSecretArtifactUnchanged = async (
  artifactPath: string,
  plaintext: Uint8Array,
  identityFile: string,
) => {
  let existingCiphertext: string;

  try {
    existingCiphertext = await readFile(artifactPath, "utf8");
  } catch {
    return false;
  }

  try {
    const existingPlaintext = await decryptSecretFile(
      existingCiphertext,
      identityFile,
    );

    if (existingPlaintext.length !== plaintext.length) {
      return false;
    }

    return existingPlaintext.every((byte, index) => byte === plaintext[index]);
  } catch {
    return false;
  }
};

export const writeArtifactsToDirectory = async (
  rootDirectory: string,
  artifacts: readonly RepoArtifact[],
  ageConfig?: AgeWriteConfig,
  reporter?: ProgressReporter,
) => {
  await mkdir(rootDirectory, { recursive: true });
  let processedArtifactCount = 0;

  const noteProcessedArtifact = (relativePath: string, action: string) => {
    processedArtifactCount += 1;

    if (reporter?.verbose) {
      reportDetail(reporter, `${action} ${relativePath}`);
      return;
    }

    if (processedArtifactCount % 100 === 0) {
      reportPhase(
        reporter,
        `Processed ${processedArtifactCount} repository artifacts...`,
      );
    }
  };

  for (const artifact of artifacts) {
    const relativePath = resolveArtifactRelativePath(artifact);
    const artifactPath = join(rootDirectory, ...relativePath.split("/"));

    if (artifact.kind === "directory") {
      await mkdir(artifactPath, { recursive: true });
      noteProcessedArtifact(relativePath, "ensured repository directory");
      continue;
    }

    if (artifact.kind === "symlink") {
      await writeSymlinkNode(artifactPath, artifact.linkTarget);
      noteProcessedArtifact(relativePath, "wrote repository symlink");
      continue;
    }

    if (artifact.category === "secret" && ageConfig !== undefined) {
      const unchanged = await isSecretArtifactUnchanged(
        artifactPath,
        artifact.contents,
        ageConfig.identityFile,
      );

      if (unchanged) {
        noteProcessedArtifact(
          relativePath,
          "skipped unchanged secret artifact",
        );
        continue;
      }

      const encrypted = await encryptSecretFile(
        artifact.contents,
        ageConfig.recipients,
      );

      await writeFileNode(artifactPath, {
        contents: encrypted,
        executable: artifact.executable,
      });
      noteProcessedArtifact(relativePath, "wrote repository secret artifact");
      continue;
    }

    await writeFileNode(artifactPath, artifact);
    noteProcessedArtifact(relativePath, "wrote repository file");
  }
};
