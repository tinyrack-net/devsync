import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AppConstants } from "#app/config/constants.ts";
import {
  findOwningSyncEntry,
  resolveSyncRule,
} from "#app/config/sync-queries.ts";
import {
  hasReservedSyncArtifactSuffixSegment,
  normalizeSyncProfileName,
  normalizeSyncRepoPath,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
} from "#app/config/sync-schema.ts";
import {
  fileContentsEqual,
  shouldNormalizeTextLineEndings,
} from "#app/lib/content.ts";
import { decryptSecretFile, encryptSecretFile } from "#app/lib/crypto.ts";
import { DotweaveError } from "#app/lib/error.ts";
import {
  isExecutableMode,
  supportsPosixFileModes,
} from "#app/lib/file-mode.ts";
import {
  getPathStats,
  listDirectoryEntries,
  writeFileNode,
  writeSymlinkNode,
} from "#app/lib/filesystem.ts";
import { parseJsonc } from "#app/lib/jsonc.ts";
import {
  buildDirectoryKey,
  isPathEqualOrNested,
  normalizeLinkTarget,
} from "#app/lib/path.ts";
import { limitConcurrency } from "#app/lib/promise.ts";
import type { SnapshotNode } from "./local-snapshot.ts";
import type { EffectiveSyncConfig } from "./sync-context.ts";

type ArtifactConfig = EffectiveSyncConfig;
const execFileAsync = promisify(execFile);
const physicalProfilesRoot = "profiles";

const entryOwnsArtifactProfile = (
  entry: Pick<ResolvedSyncConfigEntry, "profiles">,
  profile: string,
) => {
  if (entry.profiles.length === 0) {
    return profile === AppConstants.SYNC.DEFAULT_PROFILE;
  }

  return entry.profiles.includes(profile);
};

const isActiveArtifactRule = (
  rule: ReturnType<typeof resolveSyncRule> | undefined,
  profile: string,
) => {
  return (
    rule !== undefined && rule.mode !== "ignore" && rule.profile === profile
  );
};

const isArtifactProfileEntryList = (
  value:
    | readonly Pick<ResolvedSyncConfigEntry, "profiles">[]
    | Pick<ResolvedSyncConfig, "entries" | "profiles">,
): value is readonly Pick<ResolvedSyncConfigEntry, "profiles">[] => {
  return Array.isArray(value);
};

export const collectArtifactProfiles = (
  configOrEntries:
    | readonly Pick<ResolvedSyncConfigEntry, "profiles">[]
    | Pick<ResolvedSyncConfig, "entries" | "profiles">,
) => {
  const profiles = new Set<string>();
  profiles.add(AppConstants.SYNC.DEFAULT_PROFILE);

  const entries = isArtifactProfileEntryList(configOrEntries)
    ? configOrEntries
    : configOrEntries.entries;
  const registeredProfiles = isArtifactProfileEntryList(configOrEntries)
    ? []
    : (configOrEntries.profiles ?? []);

  for (const profile of registeredProfiles) {
    profiles.add(profile);
  }

  for (const entry of entries) {
    for (const profile of entry.profiles) {
      profiles.add(profile);
    }
  }

  return profiles;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isRawCommittedProfileName = (profile: string) => {
  try {
    return normalizeSyncProfileName(profile) === profile;
  } catch {
    return false;
  }
};

const collectRawManifestProfiles = (manifest: unknown) => {
  const profiles = new Set<string>();

  if (!isRecord(manifest)) {
    return profiles;
  }

  const manifestRecord = manifest as {
    entries?: unknown;
    profiles?: unknown;
  };
  const registeredProfiles = manifestRecord.profiles;

  if (Array.isArray(registeredProfiles)) {
    for (const profile of registeredProfiles) {
      if (typeof profile === "string" && isRawCommittedProfileName(profile)) {
        profiles.add(profile);
      }
    }
  }

  const entries = manifestRecord.entries;

  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord(entry)) {
        continue;
      }

      const entryRecord = entry as { profiles?: unknown };

      if (!Array.isArray(entryRecord.profiles)) {
        continue;
      }

      for (const profile of entryRecord.profiles) {
        if (typeof profile === "string" && isRawCommittedProfileName(profile)) {
          profiles.add(profile);
        }
      }
    }
  }

  profiles.add(AppConstants.SYNC.DEFAULT_PROFILE);

  return profiles;
};

export const readCommittedProfileRegistry = async (syncDirectory: string) => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `HEAD:${AppConstants.SYNC.CONFIG_FILE_NAME}`],
      {
        cwd: syncDirectory,
        encoding: "utf8",
        maxBuffer: 10_000_000,
      },
    );

    return collectRawManifestProfiles(parseJsonc(stdout));
  } catch {
    return undefined;
  }
};

export const assertNoLegacyProfileArtifactDirectories = async (
  syncDirectory: string,
  profiles: ReadonlySet<string>,
) => {
  for (const profile of profiles) {
    const legacyProfileDirectory = join(syncDirectory, profile);

    if ((await getPathStats(legacyProfileDirectory))?.isDirectory() !== true) {
      continue;
    }

    throw new DotweaveError(
      "Repository uses the legacy top-level profile artifact layout.",
      {
        code: "LEGACY_REPOSITORY_LAYOUT",
        details: [
          `Profile: ${profile}`,
          `Legacy path: ${profile}/`,
          `Expected path: ${physicalProfilesRoot}/${profile}/`,
        ],
        hint: "Move repository artifacts under profiles/<profile>/ before running pull or status.",
      },
    );
  }
};

const collectConfiguredRepoPathVariants = (
  entry: Pick<ResolvedSyncConfigEntry, "configuredRepoPath" | "repoPath">,
) => {
  if (entry.configuredRepoPath === undefined) {
    return [entry.repoPath];
  }

  return [...new Set(Object.values(entry.configuredRepoPath))].map((value) => {
    return normalizeSyncRepoPath(value);
  });
};

const entryOwnsArtifactPath = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    "configuredRepoPath" | "kind" | "repoPath"
  >,
  repoPath: string,
) => {
  return collectConfiguredRepoPathVariants(entry).some((candidate) => {
    return entry.kind === "directory"
      ? isPathEqualOrNested(repoPath, candidate)
      : repoPath === candidate;
  });
};

const collectEntryRepoPathVariants = (
  entry: Pick<ResolvedSyncConfigEntry, "configuredRepoPath" | "repoPath">,
) => {
  return collectConfiguredRepoPathVariants(entry).map((repoPath) => ({
    depth: repoPath.split("/").length,
    repoPath,
  }));
};

const entryCompatibleWithArtifact = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    "configuredRepoPath" | "kind" | "repoPath"
  >,
  artifact: ReturnType<typeof parseArtifactRelativePath>,
  artifactKind: "directory" | "file",
) => {
  return collectConfiguredRepoPathVariants(entry).some((candidate) => {
    if (entry.kind === "directory") {
      return isPathEqualOrNested(artifact.repoPath, candidate);
    }

    return artifactKind === "file" && artifact.repoPath === candidate;
  });
};

export const nearestEntryOwnsArtifact = (
  entries: readonly Pick<
    ResolvedSyncConfigEntry,
    "configuredRepoPath" | "kind" | "profiles" | "repoPath"
  >[],
  artifact: ReturnType<typeof parseArtifactRelativePath>,
  artifactKind: "directory" | "file",
) => {
  let nearestEntry:
    | Pick<
        ResolvedSyncConfigEntry,
        "configuredRepoPath" | "kind" | "profiles" | "repoPath"
      >
    | undefined;
  let nearestDepth = -1;

  for (const entry of entries) {
    if (!entryOwnsArtifactProfile(entry, artifact.profile)) {
      continue;
    }

    for (const variant of collectEntryRepoPathVariants(entry)) {
      if (!isPathEqualOrNested(artifact.repoPath, variant.repoPath)) {
        continue;
      }

      if (variant.depth > nearestDepth) {
        nearestDepth = variant.depth;
        nearestEntry = entry;
      }
    }
  }

  return nearestEntry === undefined
    ? false
    : entryCompatibleWithArtifact(nearestEntry, artifact, artifactKind);
};

const activeDirectoryEntryOwnsArtifact = (
  entries: readonly Pick<
    ResolvedSyncConfigEntry,
    "configuredRepoPath" | "kind" | "mode" | "profiles" | "repoPath"
  >[],
  artifact: ReturnType<typeof parseArtifactRelativePath>,
) => {
  return entries.some((entry) => {
    return (
      entry.kind === "directory" &&
      entry.mode !== "ignore" &&
      entryOwnsArtifactProfile(entry, artifact.profile) &&
      entryOwnsArtifactPath(entry, artifact.repoPath)
    );
  });
};

export const entryOwnsArtifact = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    "configuredRepoPath" | "kind" | "profiles" | "repoPath"
  >,
  artifact: ReturnType<typeof parseArtifactRelativePath>,
) => {
  return (
    entryOwnsArtifactProfile(entry, artifact.profile) &&
    entryOwnsArtifactPath(entry, artifact.repoPath)
  );
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
  const relativePath = resolveArtifactLogicalPath(artifact);

  return artifact.kind === "directory"
    ? buildDirectoryKey(relativePath)
    : relativePath;
};

export const resolveArtifactLogicalPath = (
  artifact: Pick<RepoArtifact, "category" | "profile" | "repoPath">,
) => {
  const profileRelativePath = `${artifact.profile}/${artifact.repoPath}`;

  return artifact.category === "secret"
    ? `${profileRelativePath}${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`
    : profileRelativePath;
};

export const isSecretArtifactPath = (relativePath: string) => {
  return relativePath.endsWith(AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX);
};

export const stripSecretArtifactSuffix = (relativePath: string) => {
  if (!isSecretArtifactPath(relativePath)) {
    return undefined;
  }

  return relativePath.slice(
    0,
    -AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX.length,
  );
};

export const assertStorageSafeRepoPath = (repoPath: string) => {
  if (!hasReservedSyncArtifactSuffixSegment(repoPath)) {
    return;
  }

  throw new DotweaveError(
    `Tracked sync paths must not use the reserved suffix ${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}.`,
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
  return `${physicalProfilesRoot}/${resolveArtifactLogicalPath(artifact)}`;
};

export const parseArtifactRelativePath = (relativePath: string) => {
  const secret = relativePath.endsWith(
    AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX,
  );
  const logicalPath = secret
    ? relativePath.slice(0, -AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX.length)
    : relativePath;
  const segments = logicalPath.split("/");

  if (
    segments.length < 3 ||
    segments[0] !== physicalProfilesRoot ||
    segments[1] === undefined
  ) {
    throw new DotweaveError("Repository artifact path is invalid.", {
      code: "INVALID_REPO_ENTRY",
      details: [`Repository path: ${relativePath}`],
    });
  }

  const [, profile, ...repoPathSegments] = segments;
  const normalizedProfile = normalizeSyncProfileName(
    profile,
    "Repository artifact profile",
  );

  return {
    profile: normalizedProfile,
    repoPath: repoPathSegments.join("/"),
    secret,
  };
};

const parseArtifactLogicalPath = (relativePath: string) => {
  const secret = relativePath.endsWith(
    AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX,
  );
  const logicalPath = secret
    ? relativePath.slice(0, -AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX.length)
    : relativePath;
  const segments = logicalPath.split("/");

  if (segments.length < 2 || segments[0] === undefined) {
    throw new DotweaveError("Repository artifact key is invalid.", {
      code: "INVALID_REPO_ENTRY",
      details: [`Artifact key: ${relativePath}`],
    });
  }

  const [profile, ...repoPathSegments] = segments;

  return {
    profile: normalizeSyncProfileName(profile, "Repository artifact profile"),
    repoPath: repoPathSegments.join("/"),
    secret,
  };
};

export const buildRepoArtifacts = async (
  snapshot: ReadonlyMap<string, SnapshotNode>,
  config: ArtifactConfig,
) => {
  const artifacts: RepoArtifact[] = [];
  const seenArtifactKeys = new Set<string>();

  const addArtifact = (artifact: RepoArtifact) => {
    const key = buildArtifactKey(artifact);

    if (seenArtifactKeys.has(key)) {
      throw new DotweaveError("Duplicate repository artifact was generated.", {
        code: "DUPLICATE_REPO_ARTIFACT",
        details: [`Artifact key: ${key}`],
      });
    }

    seenArtifactKeys.add(key);
    artifacts.push(artifact);
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

export const collectArtifactLeafKeys = async (
  rootDirectory: string,
  keys: Set<string>,
  prefix?: string,
  onKey?: (key: string) => void,
  includeEmptyDirectories = false,
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

  if (entries.length === 0 && prefix !== undefined && includeEmptyDirectories) {
    const key = buildDirectoryKey(prefix);

    keys.add(key);
    onKey?.(key);
  }

  for (const entry of entries) {
    const absolutePath = join(rootDirectory, entry.name);
    const relativePath =
      prefix === undefined ? entry.name : `${prefix}/${entry.name}`;
    const stats = await lstat(absolutePath);

    if (stats?.isDirectory()) {
      await collectArtifactLeafKeys(
        absolutePath,
        keys,
        relativePath,
        onKey,
        includeEmptyDirectories,
      );
      continue;
    }

    keys.add(relativePath);
    onKey?.(relativePath);
  }
};

export const collectExistingArtifactKeys = async (
  syncDirectory: string,
  config: ArtifactConfig,
  ownershipConfig: Pick<ResolvedSyncConfig, "entries" | "profiles"> = config,
) => {
  const keys = new Set<string>();
  const artifactProfiles = collectArtifactProfiles(ownershipConfig);
  const profilesDirectory = join(syncDirectory, physicalProfilesRoot);

  const committedProfiles = await readCommittedProfileRegistry(syncDirectory);

  if (committedProfiles !== undefined) {
    for (const profile of committedProfiles) {
      artifactProfiles.add(profile);
    }
  }

  await assertNoLegacyProfileArtifactDirectories(
    syncDirectory,
    artifactProfiles,
  );

  if ((await getPathStats(profilesDirectory))?.isDirectory() === true) {
    for (const entry of await listDirectoryEntries(profilesDirectory)) {
      try {
        if (
          (
            await getPathStats(join(profilesDirectory, entry.name))
          )?.isDirectory()
        ) {
          artifactProfiles.add(normalizeSyncProfileName(entry.name));
        }
      } catch {
        // Invalid profile directory names are external repository contents, not
        // owned artifacts to delete.
      }
    }
  }

  await Promise.all(
    [...artifactProfiles].map(async (profile) => {
      await collectArtifactLeafKeys(
        join(profilesDirectory, profile),
        keys,
        profile,
        undefined,
        true,
      );
      keys.delete(buildDirectoryKey(profile));
    }),
  );

  for (const key of [...keys]) {
    if (key.startsWith("__dir__:")) {
      continue;
    }

    const isDirectoryKey = key.endsWith("/");
    const artifact = parseArtifactLogicalPath(
      isDirectoryKey ? key.slice(0, -1) : key,
    );

    if (
      isDirectoryKey &&
      nearestEntryOwnsArtifact(
        ownershipConfig.entries,
        artifact,
        "directory",
      ) &&
      !activeDirectoryEntryOwnsArtifact(config.entries, artifact)
    ) {
      keys.delete(key);
      continue;
    }

    const rule = resolveSyncRule(
      config,
      artifact.repoPath,
      config.activeProfile,
    );

    if (isActiveArtifactRule(rule, artifact.profile)) {
      continue;
    }

    if (
      !isDirectoryKey &&
      nearestEntryOwnsArtifact(ownershipConfig.entries, artifact, "file")
    ) {
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
    const logicalPath = resolveArtifactLogicalPath({
      category: "plain",
      profile: rule.profile,
      repoPath: entry.repoPath,
    });
    const path = join(syncDirectory, ...relativePath.split("/"));

    if ((await getPathStats(path))?.isDirectory()) {
      keys.add(buildDirectoryKey(logicalPath));
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

  return isExecutableMode(actualMode) === executable;
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
      normalizeLinkTarget(linkTarget) ===
        normalizeLinkTarget(artifact.linkTarget)
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
) => {
  await mkdir(rootDirectory, { recursive: true });

  await limitConcurrency(
    AppConstants.SYNC.DEFAULT_CONCURRENCY,
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
        return;
      }

      if (artifact.kind === "directory") {
        await mkdir(artifactPath, { recursive: true });
        return;
      }

      if (artifact.kind === "symlink") {
        await writeSymlinkNode(artifactPath, artifact.linkTarget);
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
        return;
      }

      await writeFileNode(artifactPath, artifact);
    },
  );
};
