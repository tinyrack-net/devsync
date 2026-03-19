import { readSyncConfig, resolveSyncConfigFilePath } from "#app/config/sync.ts";
import { resolveDevtoolsSyncDirectory } from "#app/config/xdg.ts";

import { SyncError } from "./error.ts";
import { ensureGitRepository, type GitService } from "./git.ts";
import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  countDeletedLocalNodes,
} from "./local-materialization.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";

type SyncRunRequest = Readonly<{
  dryRun: boolean;
}>;

type SyncPullResult = Readonly<{
  configPath: string;
  decryptedFileCount: number;
  deletedLocalCount: number;
  directoryCount: number;
  dryRun: boolean;
  plainFileCount: number;
  symlinkCount: number;
  syncDirectory: string;
}>;

export const pullSync = async (
  request: SyncRunRequest,
  dependencies: Readonly<{
    environment: NodeJS.ProcessEnv;
    git: GitService;
  }>,
): Promise<SyncPullResult> => {
  try {
    const syncDirectory = resolveDevtoolsSyncDirectory(
      dependencies.environment,
    );

    await ensureGitRepository(syncDirectory, dependencies.git);

    const config = await readSyncConfig(
      syncDirectory,
      dependencies.environment,
    );
    const snapshot = await buildRepositorySnapshot(syncDirectory, config);
    const materializations = config.entries.map((entry) => {
      return buildEntryMaterialization(entry, snapshot);
    });

    let deletedLocalCount = 0;

    for (let index = 0; index < config.entries.length; index += 1) {
      const entry = config.entries[index];
      const materialization = materializations[index];

      if (entry === undefined || materialization === undefined) {
        continue;
      }

      deletedLocalCount += await countDeletedLocalNodes(
        entry,
        materialization.desiredKeys,
        config,
      );

      if (!request.dryRun) {
        await applyEntryMaterialization(entry, materialization, config);
      }
    }

    const counts = buildPullCounts(materializations);

    return {
      configPath: resolveSyncConfigFilePath(syncDirectory),
      deletedLocalCount,
      dryRun: request.dryRun,
      syncDirectory,
      ...counts,
    };
  } catch (error: unknown) {
    if (error instanceof SyncError) {
      throw error;
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Sync pull failed.",
    );
  }
};
