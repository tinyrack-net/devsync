import {
  type ResolvedSyncConfig,
  readSyncConfig,
  type SyncConfigResolutionContext,
} from "#app/config/sync.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import {
  resolveSyncConfigResolutionContext,
  resolveSyncPaths,
} from "./runtime.ts";

export type MutableSyncConfig = Readonly<{
  config: ResolvedSyncConfig;
  configPath: string;
  context: SyncConfigResolutionContext;
  syncDirectory: string;
}>;

export const loadMutableSyncConfig = async (): Promise<MutableSyncConfig> => {
  const { syncDirectory, configPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();
  await ensureGitRepository(syncDirectory);
  const config = await readSyncConfig(syncDirectory, context);
  return { config, configPath, context, syncDirectory };
};
