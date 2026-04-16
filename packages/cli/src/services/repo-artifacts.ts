import { lstat, mkdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { ConsolaInstance } from "consola";
import { CONSTANTS } from "#app/config/constants.ts";
import {
  findOwningSyncEntry,
  hasReservedSyncArtifactSuffixSegment,
  type ResolvedSyncConfigEntry,
  resolveSyncRule,
} from "#app/config/sync.ts";
import {
  fileContentsEqual,
  shouldNormalizeTextLineEndings,
} from "#app/lib/content.ts";
import { decryptSecretFile, encryptSecretFile } from "#app/lib/crypto.ts";
import { DevsyncError } from "#app/lib/error.ts";
import {
  buildExecutableMode,
  supportsPosixFileModes,
} from "#app/lib/file-mode.ts";
import {
  getPathStats,
  listDirectoryEntries,
  writeFileNode,
  writeSymlinkNode,
} from "#app/lib/filesystem.ts";
import { buildDirectoryKey } from "#app/lib/path.ts";
import { limitConcurrency } from "#app/lib/promise.ts";
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

export const collectArtifactProfiles = (
  entries: readonly Pick<ResolvedSyncConfigEntry, "profiles">[],
) => {
  const profiles = new Set<string>();
  profiles.add(CONSTANTS.SYNC.DEFAULT_PROFILE);

  for (const entry of entries) {
    for (const profile of entry.profiles) {
      profiles.add(profile);
    }
  }

  return profiles;
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
  return relativePath.endsWith(CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX);
};

export const stripSecretArtifactSuffix = (relativePath: string) => {
  if (!isSecretArtifactPath(relativePath)) {
    return undefined;
  }

  return relativePath.slice(0, -CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX.length);
};

export const assertStorageSafeRepoPath = (repoPath: string) => {
  if (!hasReservedSyncArtifactSuffixSegment(repoPath)) {
    return;
  }

  throw new DevsyncError(
    `Tracked sync paths must not use the reserved suffix ${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}.`,
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
    ? `${profileRelativePath}${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}`
    : profileRelativePath;
};

export const parseArtifactRelativePath = (relativePath: string) => {
  const secret = relativePath.endsWith(CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX);
  const logicalPath = secret
    ? relativePath.slice(0, -CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX.length)
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

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ArtifactConfig,
  reporter?: ConsolaInstance,
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

    if ((reporter?.level ?? 0) >= 4) {
      reporter?.verbose(`prepared repository artifact ${relativePath}`);
    } else if (preparedArtifactCount % 100 === 0) {
      reporter?.start(
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
  reporter?: ConsolaInstance,
) => {
  const keys = new Set<string>();
  const artifactsDirectory = syncDirectory;
  const artifactProfiles = collectArtifactProfiles(config.entries);
  let discoveredArtifactCount = 0;

  const noteDiscoveredArtifact = (key: string) => {
    discoveredArtifactCount += 1;

    if ((reporter?.level ?? 0) >= 4) {
      reporter?.verbose(`found repository artifact ${key}`);
    } else if (discoveredArtifactCount % 100 === 0) {
      reporter?.start(
        `Scanned ${discoveredArtifactCount} repository artifacts...`,
      );
    }
  };

  await Promise.all(
    [...artifactProfiles].map(async (profile) => {
      await collectArtifactLeafKeys(
        join(artifactsDirectory, profile),
        keys,
        profile,
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

const fileModeMatches = (actualMode: number, executable: boolean) => {
  if (!supportsPosixFileModes()) {
    return true;
  }

  return (actualMode & 0o777) === buildExecutableMode(executable);
};

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

    return fileContentsEqual(existingPlaintext, plaintext, {
      normalizeTextLineEndings: shouldNormalizeTextLineEndings(),
    });
  } catch {
    return false;
  }
};

const normalizeLinkTargetForComparison = (target: string) => {
  return process.platform === "win32" ? target.replaceAll("\\", "/") : target;
};

export const isRepoArtifactCurrent = async (
  rootDirectory: string,
  artifact: RepoArtifact,
  ageConfig?: Pick<AgeWriteConfig, "identityFile">,
) => {
  const relativePath = resolveArtifactRelativePath(artifact);
  const artifactPath = join(rootDirectory, ...relativePath.split("/"));
  const stats = await getPathStats(artifactPath);

  if (artifact.kind === "directory") {
    return stats?.isDirectory() ?? false;
  }

  if (artifact.kind === "symlink") {
    const linkTarget =
      stats?.isSymbolicLink() === true ? await readlink(artifactPath) : "";

    return (
      stats?.isSymbolicLink() === true &&
      normalizeLinkTargetForComparison(linkTarget) ===
        normalizeLinkTargetForComparison(artifact.linkTarget)
    );
  }

  if (stats?.isFile() !== true) {
    return false;
  }

  if (!fileModeMatches(stats.mode, artifact.executable)) {
    return false;
  }

  if (artifact.category === "secret") {
    if (ageConfig === undefined) {
      return false;
    }

    return isSecretArtifactUnchanged(
      artifactPath,
      artifact.contents,
      ageConfig.identityFile,
    );
  }

  const existingContents = await readFile(artifactPath);

  return fileContentsEqual(existingContents, artifact.contents, {
    normalizeTextLineEndings: shouldNormalizeTextLineEndings(),
  });
};

export const writeArtifactsToDirectory = async (
  rootDirectory: string,
  artifacts: readonly RepoArtifact[],
  ageConfig?: AgeWriteConfig,
  reporter?: ConsolaInstance,
) => {
  await mkdir(rootDirectory, { recursive: true });
  let processedArtifactCount = 0;

  const noteProcessedArtifact = (relativePath: string, action: string) => {
    processedArtifactCount += 1;

    if ((reporter?.level ?? 0) >= 4) {
      reporter?.verbose(`${action} ${relativePath}`);
      return;
    }

    if (processedArtifactCount % 100 === 0) {
      reporter?.start(
        `Processed ${processedArtifactCount} repository artifacts...`,
      );
    }
  };

  await limitConcurrency(
    CONSTANTS.SYNC.DEFAULT_CONCURRENCY,
    artifacts,
    async (artifact) => {
      const relativePath = resolveArtifactRelativePath(artifact);
      const artifactPath = join(rootDirectory, ...relativePath.split("/"));

      if (
        await isRepoArtifactCurrent(
          rootDirectory,
          artifact,
          ageConfig === undefined
            ? undefined
            : { identityFile: ageConfig.identityFile },
        )
      ) {
        noteProcessedArtifact(
          relativePath,
          "skipped unchanged repository artifact",
        );
        return;
      }

      if (artifact.kind === "directory") {
        await mkdir(artifactPath, { recursive: true });
        noteProcessedArtifact(relativePath, "ensured repository directory");
        return;
      }

      if (artifact.kind === "symlink") {
        await writeSymlinkNode(artifactPath, artifact.linkTarget);
        noteProcessedArtifact(relativePath, "wrote repository symlink");
        return;
      }

      if (artifact.category === "secret" && ageConfig !== undefined) {
        const encrypted = await encryptSecretFile(
          artifact.contents,
          ageConfig.recipients,
        );

        await writeFileNode(artifactPath, {
          contents: encrypted,
          executable: artifact.executable,
        });
        noteProcessedArtifact(relativePath, "wrote repository secret artifact");
        return;
      }

      await writeFileNode(artifactPath, artifact);
      noteProcessedArtifact(relativePath, "wrote repository file");
    },
  );
};
