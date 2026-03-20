import { join } from "node:path";

import {
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";

import { buildLocalSnapshot, type SnapshotNode } from "./local-snapshot.ts";
import {
  buildArtifactKey,
  buildRepoArtifacts,
  collectExistingArtifactKeys,
  writeArtifactsToDirectory,
} from "./repo-artifacts.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import { runSyncUseCase } from "./use-case.ts";

export type SyncPushRequest = Readonly<{
  dryRun: boolean;
}>;

export type SyncPushResult = Readonly<{
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
  request: SyncPushRequest,
  context: SyncContext,
): Promise<SyncPushResult> => {
  return runSyncUseCase("Sync push failed.", async () => {
    await ensureSyncRepository(context);

    const config = await readSyncConfig(
      context.paths.syncDirectory,
      context.environment,
    );
    const snapshot = await buildLocalSnapshot(config, context.ports.filesystem);
    const artifacts = await buildRepoArtifacts(snapshot, config, {
      crypto: context.ports.crypto,
    });
    const desiredArtifactKeys = new Set(
      artifacts.map((artifact) => {
        return buildArtifactKey(artifact);
      }),
    );
    const existingArtifactKeys = await collectExistingArtifactKeys(
      context.paths.syncDirectory,
      config,
      context.ports.filesystem,
    );
    const deletedArtifactCount = [...existingArtifactKeys].filter((key) => {
      return !desiredArtifactKeys.has(key);
    }).length;

    if (!request.dryRun) {
      const stagingRoot = await context.ports.filesystem.mkdtemp(
        join(context.paths.syncDirectory, ".devsync-sync-push-"),
      );
      const nextArtifactsDirectory = join(stagingRoot, "files");

      try {
        await writeArtifactsToDirectory(
          nextArtifactsDirectory,
          artifacts,
          context.ports.filesystem,
        );

        await context.ports.filesystem.replacePathAtomically(
          resolveSyncArtifactsDirectoryPath(context.paths.syncDirectory),
          nextArtifactsDirectory,
        );
      } finally {
        await context.ports.filesystem.rm(stagingRoot, {
          force: true,
          recursive: true,
        });
      }
    }

    const counts = buildPushCounts(snapshot);

    return {
      configPath: context.paths.configPath,
      deletedArtifactCount,
      dryRun: request.dryRun,
      syncDirectory: context.paths.syncDirectory,
      ...counts,
    };
  });
};
