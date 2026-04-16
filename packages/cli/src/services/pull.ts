import type { ConsolaInstance } from "consola";
import { resolveSyncConfigFilePath } from "#app/config/sync.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import { isPathEqualOrNested } from "#app/lib/path.ts";
import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  collectChangedLocalPaths,
  countDeletedLocalNodes,
  type EntryMaterialization,
} from "./local-materialization.ts";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";
import {
  type EffectiveSyncConfig,
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
  const keyToLocalPath = new Map<string, string>();
  const deletedKeys = new Set<string>();

  reporter?.start("Scanning existing local paths...");
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
      reporter,
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
    await buildUpdatedLocalPaths(
      config,
      materializations,
    )
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
  const prepared = await preparePull(request, reporter);

  if (!request.dryRun) {
    await applyPullPlan(prepared.config, prepared.plan, reporter);
  }

  return buildPullResultFromPlan(
    prepared.plan,
    prepared.syncDirectory,
    request.dryRun,
  );
};

export const preparePull = async (
  request: PullRequest,
  reporter?: ConsolaInstance,
): Promise<PreparedPull> => {
  reporter?.start("Starting pull...");
  const { syncDirectory } = resolveSyncPaths();

  reporter?.start("Checking sync directory...");
  await ensureGitRepository(syncDirectory);

  reporter?.start("Loading sync configuration...");
  const { effectiveConfig: config } = await loadSyncConfig(syncDirectory, {
    ...(request.profile === undefined ? {} : { profile: request.profile }),
  });
  const plan = await buildPullPlan(config, syncDirectory, reporter);

  return {
    config,
    plan,
    syncDirectory,
  };
};

export const applyPullPlan = async (
  config: EffectiveSyncConfig,
  plan: PullPlan,
  reporter?: ConsolaInstance,
) => {
  for (let index = 0; index < config.entries.length; index += 1) {
    const entry = config.entries[index];
    const materialization = plan.materializations[index];

    if (entry === undefined || materialization === undefined) {
      continue;
    }

    reporter?.start(`Applying ${entry.repoPath}...`);
    await applyEntryMaterialization(entry, materialization, config, reporter);
  }
};
