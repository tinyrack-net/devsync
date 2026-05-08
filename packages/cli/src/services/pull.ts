import { AppConstants } from "#app/config/constants.ts";
import { requireGitRepository } from "#app/lib/git.ts";
import { doPathsOverlap, isPathEqualOrNested } from "#app/lib/path.ts";
import { limitConcurrency } from "#app/lib/promise.ts";
import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  collectChangedLocalPaths,
  countDeletedLocalNodes,
  type EntryMaterialization,
} from "./pull-apply.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import {
  type EffectiveSyncConfig,
  loadSyncConfig,
  resolveSyncPaths,
} from "./sync-context.ts";

export type PullRequest = Readonly<{
  dryRun: boolean;
  profile?: string;
}>;

export type PullResult = Readonly<{
  decryptedFileCount: number;
  deletedLocalCount: number;
  directoryCount: number;
  dryRun: boolean;
  plainFileCount: number;
  symlinkCount: number;
}>;

export type PullPlan = Readonly<{
  counts: ReturnType<typeof buildPullCounts>;
  deletedLocalCount: number;
  deletedLocalPaths: readonly string[];
  desiredKeys: ReadonlySet<string>;
  existingKeys: ReadonlySet<string>;
  materializations: readonly (EntryMaterialization | undefined)[];
  updatedLocalPaths: readonly string[];
}>;

export type PreparedPull = Readonly<{
  config: EffectiveSyncConfig;
  plan: PullPlan;
  syncDirectory: string;
}>;

const buildDeletedLocalPaths = (
  deletedKeys: ReadonlySet<string>,
  keyToLocalPath: ReadonlyMap<string, string>,
) => {
  return [...deletedKeys]
    .map((key) => {
      return keyToLocalPath.get(key);
    })
    .filter((path): path is string => {
      return path !== undefined;
    })
    .sort((left, right) => {
      return left.localeCompare(right);
    });
};

const buildUpdatedLocalPaths = async (
  config: EffectiveSyncConfig,
  materializations: readonly (EntryMaterialization | undefined)[],
) => {
  const changedLocalPaths = new Set<string>();

  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    const materialization = materializations[index];

    if (entry === undefined || materialization === undefined) {
      continue;
    }

    const childEntryLocalPaths =
      entry.kind !== "directory"
        ? []
        : config.entries
            .filter((candidate) => {
              return (
                candidate !== entry &&
                isPathEqualOrNested(candidate.localPath, entry.localPath)
              );
            })
            .map((candidate) => {
              return candidate.localPath;
            });

    for (const path of await collectChangedLocalPaths(
      entry,
      materialization,
      config,
    )) {
      if (
        childEntryLocalPaths.some((childPath) => {
          return isPathEqualOrNested(path, childPath);
        })
      ) {
        continue;
      }

      changedLocalPaths.add(path);
    }
  }

  return [...changedLocalPaths].sort((left, right) => {
    return left.localeCompare(right);
  });
};

export const buildPullPlan = async (
  config: EffectiveSyncConfig,
  syncDirectory: string,
): Promise<PullPlan> => {
  const snapshot = await buildRepositorySnapshot(syncDirectory, config);
  const materializations = config.entries.map((entry) => {
    if (entry.mode === "ignore") {
      return undefined;
    }

    return buildEntryMaterialization(entry, snapshot, config);
  });

  let deletedLocalCount = 0;
  const existingKeys = new Set<string>();
  const keyToLocalPath = new Map<string, string>();
  const deletedKeys = new Set<string>();

  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    const materialization = materializations[index];

    if (entry === undefined || materialization === undefined) {
      continue;
    }

    const entryExistingKeys = new Set<string>();
    const entryKeyToLocalPath = new Map<string, string>();

    deletedLocalCount += await countDeletedLocalNodes(
      entry,
      materialization.desiredKeys,
      config,
      entryExistingKeys,
      entryKeyToLocalPath,
      deletedKeys,
    );

    for (const key of entryExistingKeys) {
      existingKeys.add(key);
    }

    for (const [key, localPath] of entryKeyToLocalPath.entries()) {
      keyToLocalPath.set(key, localPath);
    }
  }

  const desiredKeys = new Set(
    materializations.flatMap((m) =>
      m === undefined ? [] : [...m.desiredKeys],
    ),
  );
  const deletedLocalPaths = buildDeletedLocalPaths(deletedKeys, keyToLocalPath);
  const deletedLocalPathSet = new Set(deletedLocalPaths);
  const updatedLocalPaths = (
    await buildUpdatedLocalPaths(config, materializations)
  ).filter((path) => {
    return !deletedLocalPathSet.has(path);
  });

  return {
    counts: buildPullCounts(materializations),
    deletedLocalCount,
    deletedLocalPaths,
    desiredKeys,
    existingKeys,
    materializations,
    updatedLocalPaths,
  };
};

export const buildPullPlanPreview = (plan: PullPlan) => {
  return [
    ...plan.updatedLocalPaths.slice(0, 4),
    ...plan.deletedLocalPaths.slice(0, 4),
  ].slice(0, 6);
};

export const buildPullResultFromPlan = (
  plan: PullPlan,
  dryRun: boolean,
): PullResult => {
  return {
    deletedLocalCount: plan.deletedLocalCount,
    dryRun,
    ...plan.counts,
  };
};

export const pullChanges = async (
  request: PullRequest,
): Promise<PullResult> => {
  const prepared = await preparePull(request);

  if (!request.dryRun) {
    await applyPullPlan(prepared.config, prepared.plan);
  }

  return buildPullResultFromPlan(prepared.plan, request.dryRun);
};

export const preparePull = async (
  request: PullRequest,
): Promise<PreparedPull> => {
  const { syncDirectory } = resolveSyncPaths();

  await requireGitRepository(syncDirectory);

  const { effectiveConfig: config } = await loadSyncConfig(syncDirectory, {
    ...(request.profile === undefined ? {} : { profile: request.profile }),
  });
  const plan = await buildPullPlan(config, syncDirectory);

  return {
    config,
    plan,
    syncDirectory,
  };
};

const buildApplyPullPlanBatches = (
  config: EffectiveSyncConfig,
  plan: PullPlan,
) => {
  const batches: number[][] = [];

  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    const materialization = plan.materializations[index];

    if (entry === undefined || materialization === undefined) {
      continue;
    }

    let assignedBatch: number[] | undefined;

    for (const batch of batches) {
      const overlapsBatch = batch.some((batchIndex) => {
        const batchEntry = config.entries[batchIndex];

        return (
          batchEntry !== undefined &&
          doPathsOverlap(entry.localPath, batchEntry.localPath)
        );
      });

      if (!overlapsBatch) {
        assignedBatch = batch;
        break;
      }
    }

    if (assignedBatch === undefined) {
      assignedBatch = [];
      batches.push(assignedBatch);
    }

    assignedBatch.push(index);
  }

  return batches;
};

export const applyPullPlan = async (
  config: EffectiveSyncConfig,
  plan: PullPlan,
) => {
  for (const batch of buildApplyPullPlanBatches(config, plan)) {
    await limitConcurrency(
      AppConstants.SYNC.DEFAULT_CONCURRENCY,
      batch,
      async (index) => {
        const entry = config.entries[index];
        const materialization = plan.materializations[index];

        if (entry === undefined || materialization === undefined) {
          return;
        }

        await applyEntryMaterialization(entry, materialization, config);
      },
    );
  }
};
