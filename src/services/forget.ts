import { dirname, join, posix } from "node:path";

import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { SyncError } from "./error.ts";
import type { FilesystemPort } from "./filesystem.ts";
import {
  isExplicitLocalPath,
  isPathEqualOrNested,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import {
  isSecretArtifactPath,
  resolveArtifactRelativePath,
} from "./repo-artifacts.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import { runSyncUseCase } from "./use-case.ts";

export type SyncForgetRequest = Readonly<{
  target: string;
}>;

export type SyncForgetResult = Readonly<{
  configPath: string;
  localPath: string;
  plainArtifactCount: number;
  repoPath: string;
  secretArtifactCount: number;
  syncDirectory: string;
}>;

const findMatchingTrackedEntry = (
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
  const byLocalPath = config.entries.find((entry) => {
    return entry.localPath === resolvedTargetPath;
  });

  if (byLocalPath !== undefined || isExplicitLocalPath(trimmedTarget)) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return undefined;
  }

  return config.entries.find((entry) => {
    return entry.repoPath === normalizedRepoPath;
  });
};

const collectRepoArtifactCounts = async (
  targetPath: string,
  counts: {
    plain: number;
    secret: number;
  },
  relativePath: string,
  filesystem: Pick<FilesystemPort, "getPathStats" | "listDirectoryEntries">,
) => {
  const stats = await filesystem.getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  if (stats.isDirectory()) {
    counts.plain += 1;

    const entries = await filesystem.listDirectoryEntries(targetPath);

    for (const entry of entries) {
      await collectRepoArtifactCounts(
        join(targetPath, entry.name),
        counts,
        posix.join(relativePath, entry.name),
        filesystem,
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
  filesystem: Pick<FilesystemPort, "getPathStats" | "listDirectoryEntries">,
) => {
  const artifactsRoot = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const counts = {
    plain: 0,
    secret: 0,
  };

  if (entry.kind === "directory") {
    await collectRepoArtifactCounts(
      join(artifactsRoot, ...entry.repoPath.split("/")),
      counts,
      entry.repoPath,
      filesystem,
    );
  } else {
    await collectRepoArtifactCounts(
      join(artifactsRoot, ...entry.repoPath.split("/")),
      counts,
      entry.repoPath,
      filesystem,
    );
    await collectRepoArtifactCounts(
      join(
        artifactsRoot,
        ...resolveArtifactRelativePath({
          category: "secret",
          repoPath: entry.repoPath,
        }).split("/"),
      ),
      counts,
      resolveArtifactRelativePath({
        category: "secret",
        repoPath: entry.repoPath,
      }),
      filesystem,
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
  filesystem: Pick<FilesystemPort, "getPathStats" | "readdir" | "rm">,
) => {
  let currentPath = startPath;

  while (
    isPathEqualOrNested(currentPath, rootPath) &&
    currentPath !== rootPath
  ) {
    const stats = await filesystem.getPathStats(currentPath);

    if (stats === undefined) {
      currentPath = dirname(currentPath);
      continue;
    }

    if (!stats.isDirectory()) {
      break;
    }

    const entries = await filesystem.readdir(currentPath);

    if (entries.length > 0) {
      break;
    }

    await filesystem.rm(currentPath, { force: true, recursive: true });
    currentPath = dirname(currentPath);
  }
};

const removeTrackedEntryArtifacts = async (
  syncDirectory: string,
  entry: ResolvedSyncConfigEntry,
  filesystem: Pick<
    FilesystemPort,
    "getPathStats" | "readdir" | "removePathAtomically" | "rm"
  >,
) => {
  const artifactsRoot = resolveSyncArtifactsDirectoryPath(syncDirectory);
  const plainPath = join(artifactsRoot, ...entry.repoPath.split("/"));

  await filesystem.removePathAtomically(plainPath);
  await pruneEmptyParentDirectories(
    dirname(plainPath),
    artifactsRoot,
    filesystem,
  );

  if (entry.kind === "directory") {
    return;
  }

  const secretPath = join(
    artifactsRoot,
    ...resolveArtifactRelativePath({
      category: "secret",
      repoPath: entry.repoPath,
    }).split("/"),
  );

  await filesystem.removePathAtomically(secretPath);
  await pruneEmptyParentDirectories(
    dirname(secretPath),
    artifactsRoot,
    filesystem,
  );
};

export const forgetSyncTarget = async (
  request: SyncForgetRequest,
  context: SyncContext,
): Promise<SyncForgetResult> => {
  return runSyncUseCase("Sync forget failed.", async () => {
    const target = request.target.trim();

    if (target.length === 0) {
      throw new SyncError("Target path is required.");
    }

    await ensureSyncRepository(context);

    const config = await readSyncConfig(
      context.paths.syncDirectory,
      context.environment,
    );
    const entry = findMatchingTrackedEntry(config, target, context);

    if (entry === undefined) {
      throw new SyncError(`No tracked sync entry matches: ${target}`);
    }

    const { plainArtifactCount, secretArtifactCount } =
      await collectEntryArtifactCounts(
        context.paths.syncDirectory,
        entry,
        context.ports.filesystem,
      );
    const nextConfig = createSyncConfigDocument(config);

    nextConfig.entries = sortSyncConfigEntries(
      nextConfig.entries.filter((configEntry) => {
        return configEntry.repoPath !== entry.repoPath;
      }),
    );

    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
      filesystem: context.ports.filesystem,
    });
    await removeTrackedEntryArtifacts(
      context.paths.syncDirectory,
      entry,
      context.ports.filesystem,
    );

    return {
      configPath: context.paths.configPath,
      localPath: entry.localPath,
      plainArtifactCount,
      repoPath: entry.repoPath,
      secretArtifactCount,
      syncDirectory: context.paths.syncDirectory,
    };
  });
};
