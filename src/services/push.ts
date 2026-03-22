import { join } from "node:path";

import { resolveSyncArtifactsDirectoryPath } from "#app/config/sync.js";

import { removePathAtomically } from "./filesystem.js";
import { buildLocalSnapshot, type SnapshotNode } from "./local-snapshot.js";
import {
  buildArtifactKey,
  buildRepoArtifacts,
  collectExistingArtifactKeys,
  writeArtifactsToDirectory,
} from "./repo-artifacts.js";
import {
  type EffectiveSyncConfig,
  ensureSyncRepository,
  loadSyncConfig,
  type SyncContext,
} from "./runtime.js";

export type SyncPushRequest = Readonly<{
  dryRun: boolean;
  machine?: string;
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

export type PushPlan = Readonly<{
  counts: ReturnType<typeof buildPushCounts>;
  deletedArtifactCount: number;
  desiredArtifactKeys: ReadonlySet<string>;
  existingArtifactKeys: ReadonlySet<string>;
  snapshot: ReadonlyMap<string, SnapshotNode>;
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

export const buildPushPlan = async (
  config: EffectiveSyncConfig,
  context: SyncContext,
): Promise<PushPlan> => {
  const snapshot = await buildLocalSnapshot(config);
  const artifacts = await buildRepoArtifacts(snapshot, config);
  const desiredArtifactKeys = new Set(
    artifacts.map((artifact) => {
      return buildArtifactKey(artifact);
    }),
  );
  const existingArtifactKeys = await collectExistingArtifactKeys(
    context.paths.syncDirectory,
    config,
  );
  const deletedArtifactCount = [...existingArtifactKeys].filter((key) => {
    return !desiredArtifactKeys.has(key);
  }).length;

  return {
    counts: buildPushCounts(snapshot),
    deletedArtifactCount,
    desiredArtifactKeys,
    existingArtifactKeys,
    snapshot,
  };
};

export const buildPushPlanPreview = (plan: PushPlan) => {
  const createdOrUpdated = [...plan.snapshot.keys()].sort((left, right) => {
    return left.localeCompare(right);
  });
  const deleted = [...plan.existingArtifactKeys]
    .filter((key) => {
      return !plan.desiredArtifactKeys.has(key);
    })
    .sort((left, right) => {
      return left.localeCompare(right);
    });

  return [...createdOrUpdated.slice(0, 4), ...deleted.slice(0, 4)].slice(0, 6);
};

export const buildPushResultFromPlan = (
  plan: PushPlan,
  context: SyncContext,
  dryRun: boolean,
): SyncPushResult => {
  return {
    configPath: context.paths.configPath,
    deletedArtifactCount: plan.deletedArtifactCount,
    dryRun,
    syncDirectory: context.paths.syncDirectory,
    ...plan.counts,
  };
};

export const pushSync = async (
  request: SyncPushRequest,
  context: SyncContext,
): Promise<SyncPushResult> => {
  await ensureSyncRepository(context);

  const { effectiveConfig: config } = await loadSyncConfig(context, {
    ...(request.machine === undefined ? {} : { machine: request.machine }),
  });
  const plan = await buildPushPlan(config, context);

  if (!request.dryRun) {
    const artifactsDirectory = resolveSyncArtifactsDirectoryPath(
      context.paths.syncDirectory,
    );
    const artifacts = await buildRepoArtifacts(plan.snapshot, config);

    for (const staleKey of [...plan.existingArtifactKeys].filter((key) => {
      return !plan.desiredArtifactKeys.has(key);
    })) {
      const relativePath = staleKey.endsWith("/")
        ? staleKey.slice(0, -1)
        : staleKey;

      await removePathAtomically(
        join(artifactsDirectory, ...relativePath.split("/")),
      );
    }

    await writeArtifactsToDirectory(artifactsDirectory, artifacts, config.age);
  }

  return buildPushResultFromPlan(plan, context, request.dryRun);
};
