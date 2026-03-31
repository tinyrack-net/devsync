import {
  resolveSyncConfigFilePath,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";
import { type ProgressReporter, reportPhase } from "#app/lib/progress.ts";

import {
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
} from "./pull.ts";
import {
  buildPushPlan,
  buildPushPlanPreview,
  buildPushResultFromPlan,
} from "./push.ts";
import {
  ensureSyncRepository,
  loadSyncConfig,
  resolveSyncPaths,
} from "./runtime.ts";

export type SyncStatusEntry = Readonly<{
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  mode: SyncMode;
  repoPath: string;
}>;

export type SyncStatusResult = Readonly<{
  activeProfile?: string;
  configPath: string;
  entries: readonly SyncStatusEntry[];
  entryCount: number;
  pull: ReturnType<typeof buildPullResultFromPlan> & {
    preview: readonly string[];
  };
  push: ReturnType<typeof buildPushResultFromPlan> & {
    preview: readonly string[];
  };
  recipientCount: number;
  syncDirectory: string;
}>;

export const getSyncStatus = async (
  options: Readonly<{
    profile?: string;
    reporter?: ProgressReporter;
  }> = {},
): Promise<SyncStatusResult> => {
  const reporter = options.reporter;

  reportPhase(reporter, "Analyzing sync status...");
  const { syncDirectory } = resolveSyncPaths();
  const configPath = resolveSyncConfigFilePath(syncDirectory);

  reportPhase(reporter, "Checking sync repository...");
  await ensureSyncRepository(syncDirectory);

  reportPhase(reporter, "Loading sync configuration...");
  const { effectiveConfig, fullConfig } = await loadSyncConfig(
    syncDirectory,
    options,
  );
  reportPhase(reporter, "Building push plan...");
  const pushPlan = await buildPushPlan(
    effectiveConfig,
    syncDirectory,
    reporter,
  );
  reportPhase(reporter, "Building pull plan...");
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
      preview: buildPullPlanPreview(pullPlan),
    },
    push: {
      ...buildPushResultFromPlan(pushPlan, syncDirectory, true),
      preview: buildPushPlanPreview(pushPlan),
    },
    recipientCount: effectiveConfig.age.recipients.length,
    syncDirectory,
  };
};
