import { readdir, rm } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import {
  normalizeSyncProfileName,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import {
  getPathStats,
  listDirectoryEntries,
  removePathAtomically,
} from "./filesystem.ts";
import {
  isExplicitLocalPath,
  isPathEqualOrNested,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import {
  isSecretArtifactPath,
  resolveArtifactRelativePath,
  resolveEntryArtifactPath,
} from "./repo-artifacts.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncForgetRequest = Readonly<{
  profile?: string;
  target: string;
}>;

export type SyncForgetResult = Readonly<{
  configPath: string;
  localPath: string;
  plainArtifactCount: number;
  profile?: string;
  repoPath: string;
  secretArtifactCount: number;
  syncDirectory: string;
}>;

const findMatchingTrackedEntries = (
  config: ResolvedSyncConfig,
  target: string,
  profile: string | undefined,
  context: Pick<SyncContext, "cwd" | "environment">,
) => {
  const trimmedTarget = target.trim();
  const resolvedTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    context.environment,
    context.cwd,
  );
  const byLocalPath = config.entries.filter((entry) => {
    return entry.localPath === resolvedTargetPath && entry.profile === profile;
  });

  if (byLocalPath.length > 0 || isExplicitLocalPath(trimmedTarget)) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return [];
  }

  return config.entries.filter((entry) => {
    return entry.repoPath === normalizedRepoPath && entry.profile === profile;
  });
};

const findMatchingTrackedEntriesAcrossProfiles = (
  config: ResolvedSyncConfig,
  target: string,
  context: Pick<SyncContext, "cwd" | "environment">,
) => {
  const trimmedTarget = target.trim();
  const resolvedTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    context.environment,
    context.cwd,
  );

  if (isExplicitLocalPath(trimmedTarget)) {
    return config.entries.filter((entry) => {
      return entry.localPath === resolvedTargetPath;
    });
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return config.entries.filter((entry) => {
      return entry.localPath === resolvedTargetPath;
    });
  }

  return config.entries.filter((entry) => {
    return (
      entry.localPath === resolvedTargetPath ||
      entry.repoPath === normalizedRepoPath
    );
  });
};

const collectRepoArtifactCounts = async (
  targetPath: string,
  counts: {
    plain: number;
    secret: number;
  },
  relativePath: string,
) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (stats.isDirectory()) {
    counts.plain += 1;

    const entries = await listDirectoryEntries(targetPath);

    for (const entry of entries) {
      await collectRepoArtifactCounts(
        join(targetPath, entry.name),
        counts,
        posix.join(relativePath, entry.name),
      );
    }

    return;
  }

  if (isSecretArtifactPath(relativePath)) {
    counts.secret += 1;
  } else {
    counts.plain += 1;
  }
};

const collectEntryArtifactCounts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const artifactsRoot = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const counts = {
    plain: 0,
    secret: 0,
  };

  if (entry.kind === "directory") {
    await collectRepoArtifactCounts(
      resolveEntryArtifactPath(artifactsRoot, entry),
      counts,
      resolveArtifactRelativePath({
        category: "plain",
        profile: entry.profile,
        repoPath: entry.repoPath,
      }),
    );
  } else {
    await collectRepoArtifactCounts(
      resolveEntryArtifactPath(artifactsRoot, entry),
      counts,
      resolveArtifactRelativePath({
        category: "plain",
        profile: entry.profile,
        repoPath: entry.repoPath,
      }),
    );
    await collectRepoArtifactCounts(
      join(
        artifactsRoot,
        ...resolveArtifactRelativePath({
          category: "secret",
          profile: entry.profile,
          repoPath: entry.repoPath,
        }).split("/"),
      ),
      counts,
      resolveArtifactRelativePath({
        category: "secret",
        profile: entry.profile,
        repoPath: entry.repoPath,
      }),
    );
  }

  return {
    plainArtifactCount: counts.plain,
    secretArtifactCount: counts.secret,
  };
};

const pruneEmptyParentDirectories = async (
  startPath: string,
  rootPath: string,
) => {
  let currentPath = startPath;

  while (
    isPathEqualOrNested(currentPath, rootPath) &&
    currentPath !== rootPath
  ) {
    const stats = await getPathStats(currentPath);

    if (stats === undefined) {
      currentPath = dirname(currentPath);
      continue;
    }

    if (!stats.isDirectory()) {
      break;
    }

    const entries = await readdir(currentPath);

    if (entries.length > 0) {
      break;
    }

    await rm(currentPath, { force: true, recursive: true });
    currentPath = dirname(currentPath);
  }
};

const removeTrackedEntryArtifacts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
) => {
  const artifactsRoot = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const plainPath = resolveEntryArtifactPath(artifactsRoot, entry);

  await removePathAtomically(plainPath);
  await pruneEmptyParentDirectories(dirname(plainPath), artifactsRoot);

  if (entry.kind === "directory") {
    return;
  }

  const secretPath = join(
    artifactsRoot,
    ...resolveArtifactRelativePath({
      category: "secret",
      profile: entry.profile,
      repoPath: entry.repoPath,
    }).split("/"),
  );

  await removePathAtomically(secretPath);
  await pruneEmptyParentDirectories(dirname(secretPath), artifactsRoot);
};

export const forgetSyncTarget = async (
  request: SyncForgetRequest,
  context: SyncContext,
): Promise<SyncForgetResult> => {
  const target = request.target.trim();
  const profile =
    request.profile === undefined
      ? undefined
      : normalizeSyncProfileName(request.profile);

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.");
  }

  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const matches = findMatchingTrackedEntries(config, target, profile, context);

  if (
    profile === undefined &&
    matches.length === 0 &&
    findMatchingTrackedEntriesAcrossProfiles(config, target, context).length > 1
  ) {
    throw new DevsyncError(`Multiple profiled sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Pass --profile to choose which profiled entry to forget.",
    });
  }

  if (matches.length > 1) {
    throw new DevsyncError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path or remove the duplicate profile-specific entries manually from config.json.",
    });
  }

  const entry = matches[0];

  if (entry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`);
  }

  const { plainArtifactCount, secretArtifactCount } =
    await collectEntryArtifactCounts(context.paths.syncDirectory, entry);
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.filter((configEntry) => {
      return !(
        configEntry.repoPath === entry.repoPath &&
        configEntry.profile === entry.profile
      );
    }),
  });

  await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
    environment: context.environment,
  });
  await removeTrackedEntryArtifacts(context.paths.syncDirectory, entry);

  return {
    configPath: context.paths.configPath,
    localPath: entry.localPath,
    plainArtifactCount,
    ...(entry.profile === undefined ? {} : { profile: entry.profile }),
    repoPath: entry.repoPath,
    secretArtifactCount,
    syncDirectory: context.paths.syncDirectory,
  };
};
