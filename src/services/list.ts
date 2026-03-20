import {
  formatSyncOverrideSelector,
  readSyncConfig,
  type SyncMode,
} from "#app/config/sync.ts";

import { countConfiguredRules } from "./config-file.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

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
  configPath: string;
  entries: readonly SyncListEntry[];
  recipientCount: number;
  ruleCount: number;
  syncDirectory: string;
}>;

export const listSyncConfig = async (
  context: SyncContext,
): Promise<SyncListResult> => {
  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );

  return {
    configPath: context.paths.configPath,
    entries: config.entries.map((entry) => {
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
    recipientCount: config.age.recipients.length,
    ruleCount: countConfiguredRules(config),
    syncDirectory: context.paths.syncDirectory,
  };
};
