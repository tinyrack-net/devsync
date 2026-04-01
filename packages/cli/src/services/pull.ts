import type { ConsolaInstance } from "consola";
import { resolveSyncConfigFilePath } from "#app/config/sync.ts";
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
  resolveSyncPaths,
} from "./runtime.ts";

export type PullRequest = Readonly<{
  dryRun: boolean;
  profile?: string;
}>;

export type PullResult = Readonly<{
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
  materializations: readonly (
    | ReturnType<typeof buildEntryMaterialization>
    | undefined
  )[];
}>;

export const buildPullPlan = async (
  config: EffectiveSyncConfig,
  syncDirectory: string,
  reporter?: ConsolaInstance,
): Promise<PullPlan> => {
  reporter?.start("Scanning repository artifacts...");
  const snapshot = await buildRepositorySnapshot(
    syncDirectory,
    config,
    reporter,
  );
  reporter?.start("Planning local materializations...");
  const materializations = config.entries.map((entry) => {
    if (entry.mode === "ignore") {
      return undefined;
    }

    return buildEntryMaterialization(entry, snapshot, reporter);
  });

  let deletedLocalCount = 0;
  const existingKeys = new Set<string>();

  reporter?.start("Scanning existing local paths...");
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
      reporter,
    );
  }

  return {
    counts: buildPullCounts(materializations),
    deletedLocalCount,
    desiredKeys: new Set(
      materializations.flatMap((m) =>
        m === undefined ? [] : [...m.desiredKeys],
      ),
    ),
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
): PullResult => {
  const configPath = resolveSyncConfigFilePath(syncDirectory);
  return {
    configPath,
    deletedLocalCount: plan.deletedLocalCount,
    dryRun,
    syncDirectory,
    ...plan.counts,
  };
};

export const pullChanges = async (
  request: PullRequest,
  reporter?: ConsolaInstance,
): Promise<PullResult> => {
  reporter?.start("Starting pull...");
  const { syncDirectory } = resolveSyncPaths();

  reporter?.start("Checking sync repository...");
  await ensureSyncRepository(syncDirectory);

  reporter?.start("Loading sync configuration...");
  const { effectiveConfig: config } = await loadSyncConfig(syncDirectory, {
    ...(request.profile === undefined ? {} : { profile: request.profile }),
  });
  const plan = await buildPullPlan(config, syncDirectory, reporter);

  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    const materialization = plan.materializations[index];

    if (entry === undefined || materialization === undefined) {
      continue;
    }

    if (!request.dryRun) {
      reporter?.start(`Applying ${entry.repoPath}...`);
      await applyEntryMaterialization(entry, materialization, config, reporter);
    }
  }

  return buildPullResultFromPlan(plan, syncDirectory, request.dryRun);
};
