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
  active: boolean;
  kind: "directory" | "file";
  localPath: string;
  mode: SyncMode;
  name: string;
  overrides: readonly SyncListOverride[];
  profile?: string;
  repoPath: string;
}>;

export type SyncListResult = Readonly<{
  activeEntryCount: number;
  activeProfile?: string;
  activeProfilesMode: "none" | "single";
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

  const { effectiveConfig, fullConfig } = await loadSyncConfig(context);
  const activeEntryKeys = new Set(
    effectiveConfig.entries.map((entry) => {
      return `${entry.profile ?? ""}\u0000${entry.repoPath}`;
    }),
  );

  return {
    activeEntryCount: effectiveConfig.entries.length,
    ...(effectiveConfig.activeProfile === undefined
      ? {}
      : { activeProfile: effectiveConfig.activeProfile }),
    activeProfilesMode: effectiveConfig.activeProfilesMode,
    configPath: context.paths.configPath,
    entries: fullConfig.entries.map((entry) => {
      return {
        active: activeEntryKeys.has(
          `${entry.profile ?? ""}\u0000${entry.repoPath}`,
        ),
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
        ...(entry.profile === undefined ? {} : { profile: entry.profile }),
        repoPath: entry.repoPath,
      };
    }),
    recipientCount: fullConfig.age.recipients.length,
    ruleCount: countConfiguredRules(fullConfig),
    syncDirectory: context.paths.syncDirectory,
  };
};
