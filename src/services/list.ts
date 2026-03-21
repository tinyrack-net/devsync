import { formatSyncOverrideSelector, type SyncMode } from "#app/config/sync.ts";

import { countConfiguredRules } from "./config-file.ts";
import {
  ensureSyncRepository,
  loadSyncConfig,
  type SyncContext,
} from "./runtime.ts";

export type SyncListOverride = Readonly<{
  mode: SyncMode;
  selector: string;
}>;

export type SyncListEntry = Readonly<{
  kind: "directory" | "file";
  localPath: string;
  mode: SyncMode;
  name: string;
  overrides: readonly SyncListOverride[];
  repoPath: string;
}>;

export type SyncListResult = Readonly<{
  activeMachine?: string;
  configPath: string;
  entries: readonly SyncListEntry[];
  recipientCount: number;
  ruleCount: number;
  syncDirectory: string;
}>;

export const listSyncConfig = async (
  context: SyncContext,
  options: Readonly<{
    machine?: string;
  }> = {},
): Promise<SyncListResult> => {
  await ensureSyncRepository(context);

  const { effectiveConfig, fullConfig } = await loadSyncConfig(
    context,
    options,
  );

  return {
    ...(effectiveConfig.activeMachine === undefined
      ? {}
      : { activeMachine: effectiveConfig.activeMachine }),
    configPath: context.paths.configPath,
    entries: fullConfig.entries.map((entry) => {
      return {
        kind: entry.kind,
        localPath: entry.localPath,
        mode: entry.mode,
        name: entry.name,
        overrides: entry.overrides.map((override) => {
          return {
            mode: override.mode,
            selector: formatSyncOverrideSelector(override),
          };
        }),
        repoPath: entry.repoPath,
      };
    }),
    recipientCount: fullConfig.age.recipients.length,
    ruleCount: countConfiguredRules(fullConfig),
    syncDirectory: context.paths.syncDirectory,
  };
};
