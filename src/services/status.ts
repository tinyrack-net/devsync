import type { SyncConfigEntryKind, SyncMode } from "#app/config/sync.js";

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
  type SyncContext,
} from "./runtime.js";

export type SyncStatusEntry = Readonly<{
  kind: SyncConfigEntryKind;
  localPath: string;
  machines: readonly string[];
  mode: SyncMode;
  name: string;
  repoPath: string;
}>;

export type SyncStatusResult = Readonly<{
  activeMachine?: string;
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
  context: SyncContext,
  options: Readonly<{
    machine?: string;
  }> = {},
): Promise<SyncStatusResult> => {
  await ensureSyncRepository(context);

  const { effectiveConfig, fullConfig } = await loadSyncConfig(
    context,
    options,
  );
  const pushPlan = await buildPushPlan(effectiveConfig, context);
  const pullPlan = await buildPullPlan(effectiveConfig, context);

  return {
    ...(effectiveConfig.activeMachine === undefined
      ? {}
      : { activeMachine: effectiveConfig.activeMachine }),
    configPath: context.paths.configPath,
    entries: fullConfig.entries.map((entry) => ({
      kind: entry.kind,
      localPath: entry.localPath,
      machines: entry.machines,
      mode: entry.mode,
      name: entry.name,
      repoPath: entry.repoPath,
    })),
    entryCount: fullConfig.entries.length,
    pull: {
      ...buildPullResultFromPlan(pullPlan, context, true),
      preview: buildPullPlanPreview(pullPlan),
    },
    push: {
      ...buildPushResultFromPlan(pushPlan, context, true),
      preview: buildPushPlanPreview(pushPlan),
    },
    recipientCount: effectiveConfig.age.recipients.length,
    syncDirectory: context.paths.syncDirectory,
  };
};
