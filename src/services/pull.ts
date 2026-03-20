import { readSyncConfig } from "#app/config/sync.ts";

import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  countDeletedLocalNodes,
} from "./local-materialization.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import { runSyncUseCase } from "./use-case.ts";

export type SyncPullRequest = Readonly<{
  dryRun: boolean;
}>;

export type SyncPullResult = Readonly<{
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
  request: SyncPullRequest,
  context: SyncContext,
): Promise<SyncPullResult> => {
  return runSyncUseCase("Sync pull failed.", async () => {
    await ensureSyncRepository(context);

    const config = await readSyncConfig(
      context.paths.syncDirectory,
      context.environment,
    );
    const snapshot = await buildRepositorySnapshot(
      context.paths.syncDirectory,
      config,
      {
        crypto: context.ports.crypto,
        filesystem: context.ports.filesystem,
      },
    );
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
        context.ports.filesystem,
      );

      if (!request.dryRun) {
        await applyEntryMaterialization(
          entry,
          materialization,
          config,
          context.ports.filesystem,
        );
      }
    }

    const counts = buildPullCounts(materializations);

    return {
      configPath: context.paths.configPath,
      deletedLocalCount,
      dryRun: request.dryRun,
      syncDirectory: context.paths.syncDirectory,
      ...counts,
    };
  });
};
