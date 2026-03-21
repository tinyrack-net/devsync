import { countConfiguredRules } from "./config-file.ts";
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
  type SyncContext,
} from "./runtime.ts";

export type SyncStatusResult = Readonly<{
  activeEntryCount: number;
  activeMachine?: string;
  activeMachinesMode: "none" | "single";
  configPath: string;
  entryCount: number;
  pull: ReturnType<typeof buildPullResultFromPlan> & {
    preview: readonly string[];
  };
  push: ReturnType<typeof buildPushResultFromPlan> & {
    preview: readonly string[];
  };
  recipientCount: number;
  ruleCount: number;
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
    activeEntryCount: effectiveConfig.entries.length,
    ...(effectiveConfig.activeMachine === undefined
      ? {}
      : { activeMachine: effectiveConfig.activeMachine }),
    activeMachinesMode: effectiveConfig.activeMachinesMode,
    configPath: context.paths.configPath,
    entryCount: fullConfig.entries.length,
    pull: {
      ...buildPullResultFromPlan(pullPlan, context, true),
      preview: buildPullPlanPreview(pullPlan),
    },
    push: {
      ...buildPushResultFromPlan(pushPlan, context, true),
      preview: buildPushPlanPreview(pushPlan),
    },
    recipientCount: fullConfig.age.recipients.length,
    ruleCount: countConfiguredRules(fullConfig),
    syncDirectory: context.paths.syncDirectory,
  };
};
