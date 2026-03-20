import { readSyncConfig } from "#app/config/sync.ts";

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
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncStatusResult = Readonly<{
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
): Promise<SyncStatusResult> => {
  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const pushPlan = await buildPushPlan(config, context);
  const pullPlan = await buildPullPlan(config, context);

  return {
    configPath: context.paths.configPath,
    entryCount: config.entries.length,
    pull: {
      ...buildPullResultFromPlan(pullPlan, context, true),
      preview: buildPullPlanPreview(pullPlan),
    },
    push: {
      ...buildPushResultFromPlan(pushPlan, context, true),
      preview: buildPushPlanPreview(pushPlan),
    },
    recipientCount: config.age.recipients.length,
    ruleCount: countConfiguredRules(config),
    syncDirectory: context.paths.syncDirectory,
  };
};
