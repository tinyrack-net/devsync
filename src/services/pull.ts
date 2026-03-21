import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  countDeletedLocalNodes,
} from "./local-materialization.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import {
  type EffectiveSyncConfig,
  ensureSyncRepository,
  loadSyncConfig,
  type SyncContext,
} from "./runtime.ts";

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

export type PullPlan = Readonly<{
  counts: ReturnType<typeof buildPullCounts>;
  deletedLocalCount: number;
  desiredKeys: ReadonlySet<string>;
  existingKeys: ReadonlySet<string>;
  materializations: readonly ReturnType<typeof buildEntryMaterialization>[];
}>;

const collectDesiredKeys = (
  materializations: readonly ReturnType<typeof buildEntryMaterialization>[],
) => {
  const keys = new Set<string>();

  for (const materialization of materializations) {
    for (const key of materialization.desiredKeys) {
      keys.add(key);
    }
  }

  return keys;
};

export const buildPullPlan = async (
  config: EffectiveSyncConfig,
  context: SyncContext,
): Promise<PullPlan> => {
  const snapshot = await buildRepositorySnapshot(
    context.paths.syncDirectory,
    config,
  );
  const materializations = config.entries.map((entry) => {
    return buildEntryMaterialization(entry, snapshot);
  });

  let deletedLocalCount = 0;
  const existingKeys = new Set<string>();

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
      existingKeys,
    );
  }

  return {
    counts: buildPullCounts(materializations),
    deletedLocalCount,
    desiredKeys: collectDesiredKeys(materializations),
    existingKeys,
    materializations,
  };
};

export const buildPullPlanPreview = (plan: PullPlan) => {
  const desired = [...plan.desiredKeys].sort((left, right) => {
    return left.localeCompare(right);
  });
  const deleted = [...plan.existingKeys]
    .filter((key) => {
      return !plan.desiredKeys.has(key);
    })
    .sort((left, right) => {
      return left.localeCompare(right);
    });

  return [...desired.slice(0, 4), ...deleted.slice(0, 4)].slice(0, 6);
};

export const buildPullResultFromPlan = (
  plan: PullPlan,
  context: SyncContext,
  dryRun: boolean,
): SyncPullResult => {
  return {
    configPath: context.paths.configPath,
    deletedLocalCount: plan.deletedLocalCount,
    dryRun,
    syncDirectory: context.paths.syncDirectory,
    ...plan.counts,
  };
};

export const pullSync = async (
  request: SyncPullRequest,
  context: SyncContext,
): Promise<SyncPullResult> => {
  await ensureSyncRepository(context);

  const { effectiveConfig: config } = await loadSyncConfig(context);
  const plan = await buildPullPlan(config, context);

  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    const materialization = plan.materializations[index];

    if (entry === undefined || materialization === undefined) {
      continue;
    }

    if (!request.dryRun) {
      await applyEntryMaterialization(entry, materialization, config);
    }
  }

  return buildPullResultFromPlan(plan, context, request.dryRun);
};
