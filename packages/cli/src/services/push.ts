import { join } from "node:path";
import type { ConsolaInstance } from "consola";
import { resolveSyncConfigFilePath } from "#app/config/sync.ts";
import { removePathAtomically } from "#app/lib/filesystem.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import { buildLocalSnapshot, type SnapshotNode } from "./local-snapshot.ts";
import {
  buildArtifactKey,
  buildRepoArtifacts,
  collectExistingArtifactKeys,
  type RepoArtifact,
  writeArtifactsToDirectory,
} from "./repo-artifacts.ts";
import {
  type EffectiveSyncConfig,
  loadSyncConfig,
  resolveSyncPaths,
} from "./runtime.ts";

export type PushRequest = Readonly<{
  dryRun: boolean;
  profile?: string;
}>;

export type PushResult = Readonly<{
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
  artifacts: readonly RepoArtifact[];
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
  syncDirectory: string,
  reporter?: ConsolaInstance,
): Promise<PushPlan> => {
  reporter?.start("Scanning local files...");
  const snapshot = await buildLocalSnapshot(config, reporter);
  reporter?.start("Preparing repository artifacts...");
  const artifacts = await buildRepoArtifacts(snapshot, config, reporter);
  const desiredArtifactKeys = new Set(
    artifacts.map((artifact) => {
      return buildArtifactKey(artifact);
    }),
  );
  reporter?.start("Scanning existing repository artifacts...");
  const existingArtifactKeys = await collectExistingArtifactKeys(
    syncDirectory,
    config,
    reporter,
  );
  const deletedArtifactCount = [...existingArtifactKeys].filter((key) => {
    return !desiredArtifactKeys.has(key);
  }).length;

  return {
    artifacts,
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
  syncDirectory: string,
  dryRun: boolean,
): PushResult => {
  const configPath = resolveSyncConfigFilePath(syncDirectory);
  return {
    configPath,
    deletedArtifactCount: plan.deletedArtifactCount,
    dryRun,
    syncDirectory,
    ...plan.counts,
  };
};

export const pushChanges = async (
  request: PushRequest,
  reporter?: ConsolaInstance,
): Promise<PushResult> => {
  reporter?.start("Starting push...");
  const { syncDirectory } = resolveSyncPaths();

  reporter?.start("Checking sync directory...");
  await ensureGitRepository(syncDirectory);

  reporter?.start("Loading sync configuration...");
  const { effectiveConfig: config } = await loadSyncConfig(syncDirectory, {
    ...(request.profile === undefined ? {} : { profile: request.profile }),
  });
  const plan = await buildPushPlan(config, syncDirectory, reporter);

  if (!request.dryRun) {
    const artifactsDirectory = syncDirectory;
    const staleArtifactKeys = [...plan.existingArtifactKeys].filter((key) => {
      return !plan.desiredArtifactKeys.has(key);
    });

    if (staleArtifactKeys.length > 0) {
      reporter?.start(
        `Removing ${staleArtifactKeys.length} stale repository artifact${staleArtifactKeys.length === 1 ? "" : "s"}...`,
      );
    }

    let removedArtifactCount = 0;

    for (const staleKey of staleArtifactKeys) {
      const relativePath = staleKey.endsWith("/")
        ? staleKey.slice(0, -1)
        : staleKey;

      removedArtifactCount += 1;

      if ((reporter?.level ?? 0) >= 4) {
        reporter?.verbose(`removing stale repository artifact ${relativePath}`);
      } else if (removedArtifactCount % 100 === 0) {
        reporter?.start(
          `Removed ${removedArtifactCount} stale repository artifacts...`,
        );
      }

      await removePathAtomically(
        join(artifactsDirectory, ...relativePath.split("/")),
      );
    }

    reporter?.start(
      `Writing ${plan.artifacts.length} repository artifact${plan.artifacts.length === 1 ? "" : "s"}...`,
    );
    await writeArtifactsToDirectory(
      artifactsDirectory,
      plan.artifacts,
      config.age,
      reporter,
    );
  }

  return buildPushResultFromPlan(plan, syncDirectory, request.dryRun);
};
