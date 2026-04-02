import type { ConsolaInstance } from "consola";
import {
  resolveSyncConfigFilePath,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
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
import { loadSyncConfig, resolveSyncPaths } from "./runtime.ts";

export type StatusEntry = Readonly<{
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  mode: SyncMode;
  repoPath: string;
}>;

export type StatusResult = Readonly<{
  activeProfile?: string;
  configPath: string;
  entries: readonly StatusEntry[];
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
