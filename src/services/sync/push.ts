import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  readSyncConfig,
  resolveSyncConfigFilePath,
  resolveSyncPlainDirectoryPath,
  resolveSyncSecretDirectoryPath,
} from "#app/config/sync.ts";
import { resolveDevsyncSyncDirectory } from "#app/config/xdg.ts";

import { SyncError } from "./error.ts";
import { replacePathAtomically } from "./filesystem.ts";
import { ensureGitRepository, type GitService } from "./git.ts";
import { buildLocalSnapshot, type SnapshotNode } from "./local-snapshot.ts";
import {
  buildArtifactKey,
  buildRepoArtifacts,
  collectExistingArtifactKeys,
  writeArtifactsToDirectory,
} from "./repo-artifacts.ts";

type SyncRunRequest = Readonly<{
  dryRun: boolean;
}>;

type SyncPushResult = Readonly<{
  configPath: string;
  deletedArtifactCount: number;
  directoryCount: number;
  dryRun: boolean;
  encryptedFileCount: number;
  plainFileCount: number;
  symlinkCount: number;
  syncDirectory: string;
}>;

const buildPushCounts = (snapshot: ReadonlyMap<string, SnapshotNode>) => {
  let directoryCount = 0;
  let encryptedFileCount = 0;
  let plainFileCount = 0;
  let symlinkCount = 0;

  for (const node of snapshot.values()) {
    if (node.type === "directory") {
      directoryCount += 1;
      continue;
    }

    if (node.type === "symlink") {
      symlinkCount += 1;
      continue;
    }

    if (node.secret) {
      encryptedFileCount += 1;
    } else {
      plainFileCount += 1;
    }
  }

  return {
    directoryCount,
    encryptedFileCount,
    plainFileCount,
    symlinkCount,
  };
};

export const pushSync = async (
  request: SyncRunRequest,
  dependencies: Readonly<{
    environment: NodeJS.ProcessEnv;
    git: GitService;
  }>,
): Promise<SyncPushResult> => {
  try {
    const syncDirectory = resolveDevsyncSyncDirectory(dependencies.environment);

    await ensureGitRepository(syncDirectory, dependencies.git);

    const config = await readSyncConfig(
      syncDirectory,
      dependencies.environment,
    );
    const snapshot = await buildLocalSnapshot(config);
    const artifacts = await buildRepoArtifacts(snapshot, config);
    const desiredArtifactKeys = new Set(
      artifacts.map((artifact) => {
        return buildArtifactKey(artifact);
      }),
    );
    const existingArtifactKeys = await collectExistingArtifactKeys(
      syncDirectory,
      config,
    );
    const deletedArtifactCount = [...existingArtifactKeys].filter((key) => {
      return !desiredArtifactKeys.has(key);
    }).length;

    if (!request.dryRun) {
      const stagingRoot = await mkdtemp(
        join(syncDirectory, ".devsync-sync-push-"),
      );
      const nextPlainDirectory = join(stagingRoot, "plain");
      const nextSecretDirectory = join(stagingRoot, "secret");

      try {
        await writeArtifactsToDirectory(
          nextPlainDirectory,
          artifacts.filter((artifact) => {
            return artifact.category === "plain";
          }),
        );
        await writeArtifactsToDirectory(
          nextSecretDirectory,
          artifacts.filter((artifact) => {
            return artifact.category === "secret";
          }),
        );

        await replacePathAtomically(
          resolveSyncPlainDirectoryPath(syncDirectory),
          nextPlainDirectory,
        );
        await replacePathAtomically(
          resolveSyncSecretDirectoryPath(syncDirectory),
          nextSecretDirectory,
        );
      } finally {
        await rm(stagingRoot, { force: true, recursive: true });
      }
    }

    const counts = buildPushCounts(snapshot);

    return {
      configPath: resolveSyncConfigFilePath(syncDirectory),
      deletedArtifactCount,
      dryRun: request.dryRun,
      syncDirectory,
      ...counts,
    };
  } catch (error: unknown) {
    if (error instanceof SyncError) {
      throw error;
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Sync push failed.",
    );
  }
};
