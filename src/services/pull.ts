import { resolveSyncConfigFilePath } from "#app/config/sync.js";
import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  countDeletedLocalNodes,
} from "./local-materialization.js";
import { buildRepositorySnapshot } from "./repo-snapshot.js";

import {
  type EffectiveSyncConfig,
  ensureSyncRepository,
  loadSyncConfig,
  resolveSyncPaths,
} from "./runtime.js";

export type SyncPullRequest = Readonly<{
  dryRun: boolean;
  profile?: string;
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

export const buildPullPlan = async (
  config: EffectiveSyncConfig,
  syncDirectory: string,
): Promise<PullPlan> => {
  const snapshot = await buildRepositorySnapshot(syncDirectory, config);
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
    desiredKeys: new Set(materializations.flatMap((m) => [...m.desiredKeys])),
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
  syncDirectory: string,
  dryRun: boolean,
): SyncPullResult => {
  const configPath = resolveSyncConfigFilePath(syncDirectory);
  return {
    configPath,
    deletedLocalCount: plan.deletedLocalCount,
    dryRun,
    syncDirectory,
    ...plan.counts,
  };
};

export const pullSync = async (
  request: SyncPullRequest,
  environment: NodeJS.ProcessEnv,
): Promise<SyncPullResult> => {
  const { syncDirectory } = resolveSyncPaths(environment);

  await ensureSyncRepository(syncDirectory);

  const { effectiveConfig: config } = await loadSyncConfig(
    syncDirectory,
    environment,
    {
      ...(request.profile === undefined ? {} : { profile: request.profile }),
    },
  );
  const plan = await buildPullPlan(config, syncDirectory);

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

  return buildPullResultFromPlan(plan, syncDirectory, request.dryRun);
};
