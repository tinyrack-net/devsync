import type { ConsolaInstance } from "consola";
import {
  resolveSyncConfigFilePath,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import type { PullPlan } from "./pull.ts";
import {
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
} from "./pull.ts";
import type { PushPlan } from "./push.ts";
import {
  buildPushPlan,
  buildPushPlanPreview,
  buildPushResultFromPlan,
} from "./push.ts";
import { loadSyncConfig, resolveSyncPaths } from "./runtime.ts";

export type StatusEntry = Readonly<{
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  mode: SyncMode;
  repoPath: string;
}>;

export type PushChanges = Readonly<{
  added: readonly string[];
  modified: readonly string[];
  deleted: readonly string[];
}>;

export type PullChanges = Readonly<{
  updated: readonly string[];
  deleted: readonly string[];
}>;

export type StatusResult = Readonly<{
  activeProfile?: string;
  configPath: string;
  entries: readonly StatusEntry[];
  entryCount: number;
  pull: ReturnType<typeof buildPullResultFromPlan> & {
    changes: PullChanges;
    preview: readonly string[];
  };
  push: ReturnType<typeof buildPushResultFromPlan> & {
    changes: PushChanges;
    preview: readonly string[];
  };
  recipientCount: number;
  syncDirectory: string;
}>;

const buildPushChanges = (plan: PushPlan): PushChanges => {
  const snapshotKeys = [...plan.snapshot.keys()];
  const added = snapshotKeys
    .filter((key) => !plan.existingArtifactKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  const modified = snapshotKeys
    .filter((key) => plan.existingArtifactKeys.has(key))
    .sort((a, b) => a.localeCompare(b));
  const deleted = [...plan.existingArtifactKeys]
    .filter((key) => !plan.desiredArtifactKeys.has(key))
    .sort((a, b) => a.localeCompare(b));

  return {
    added,
    modified,
    deleted,
  };
};

const buildPullChanges = (plan: PullPlan): PullChanges => {
  return {
    updated: [...plan.updatedLocalPaths],
    deleted: [...plan.deletedLocalPaths],
  };
};

export const getStatus = async (
  options: Readonly<{
    profile?: string;
    reporter?: ConsolaInstance;
  }> = {},
): Promise<StatusResult> => {
  const reporter = options.reporter;

  reporter?.start("Analyzing sync status...");
  const { syncDirectory } = resolveSyncPaths();
  const configPath = resolveSyncConfigFilePath(syncDirectory);

  reporter?.start("Checking sync directory...");
  await ensureGitRepository(syncDirectory);

  reporter?.start("Loading sync configuration...");
  const { effectiveConfig, fullConfig } = await loadSyncConfig(
    syncDirectory,
    options,
  );
  reporter?.start("Building push plan...");
  const pushPlan = await buildPushPlan(
    effectiveConfig,
    syncDirectory,
    reporter,
  );
  reporter?.start("Building pull plan...");
  const pullPlan = await buildPullPlan(
    effectiveConfig,
    syncDirectory,
    reporter,
  );

  return {
    ...(effectiveConfig.activeProfile === undefined
      ? {}
      : { activeProfile: effectiveConfig.activeProfile }),
    configPath,
    entries: fullConfig.entries.map((entry) => ({
      kind: entry.kind,
      localPath: entry.localPath,
      profiles: entry.profiles,
      mode: entry.mode,
      repoPath: entry.repoPath,
    })),
    entryCount: fullConfig.entries.length,
    pull: {
      ...buildPullResultFromPlan(pullPlan, syncDirectory, true),
      changes: buildPullChanges(pullPlan),
      preview: buildPullPlanPreview(pullPlan),
    },
    push: {
      ...buildPushResultFromPlan(pushPlan, syncDirectory, true),
      changes: buildPushChanges(pushPlan),
      preview: buildPushPlanPreview(pushPlan),
    },
    recipientCount: effectiveConfig.age.recipients.length,
    syncDirectory,
  };
};
