import type { SyncMode } from "#app/config/sync.ts";

import {
  ensureSyncRepository,
  loadSyncConfig,
  type SyncContext,
} from "./runtime.ts";

export type SyncListEntry = Readonly<{
  kind: "directory" | "file";
  localPath: string;
  machines: readonly string[];
  mode: SyncMode;
  name: string;
  repoPath: string;
}>;

export type SyncListResult = Readonly<{
  activeMachine?: string;
  configPath: string;
  entries: readonly SyncListEntry[];
  recipientCount: number;
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
        machines: entry.machines,
        mode: entry.mode,
        name: entry.name,
        repoPath: entry.repoPath,
      };
    }),
    recipientCount: effectiveConfig.age.recipients.length,
    syncDirectory: context.paths.syncDirectory,
  };
};
