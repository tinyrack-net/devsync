import {
  resolveSyncConfigFilePath,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.js";

import {
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
} from "./pull.js";
import {
  buildPushPlan,
  buildPushPlanPreview,
  buildPushResultFromPlan,
} from "./push.js";
import {
  ensureSyncRepository,
  loadSyncConfig,
  resolveSyncPaths,
} from "./runtime.js";

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
  environment: NodeJS.ProcessEnv,
  options: Readonly<{
    profile?: string;
  }> = {},
): Promise<SyncStatusResult> => {
  const { syncDirectory } = resolveSyncPaths(environment);
  const configPath = resolveSyncConfigFilePath(syncDirectory);

  await ensureSyncRepository(syncDirectory);

  const { effectiveConfig, fullConfig } = await loadSyncConfig(
    syncDirectory,
    environment,
    options,
  );
  const pushPlan = await buildPushPlan(effectiveConfig, syncDirectory);
  const pullPlan = await buildPullPlan(effectiveConfig, syncDirectory);

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
