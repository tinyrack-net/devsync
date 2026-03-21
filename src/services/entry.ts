import {
  type ResolvedSyncConfig,
  readSyncConfig,
  type SyncMode,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import {
  isExplicitLocalPath,
  resolveCommandTargetPath,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import type { SyncSetResult } from "./set.ts";

export type SyncEntryModeRequest = Readonly<{
  state: SyncMode;
  target: string;
}>;

const findExactTrackedEntry = (
  config: ResolvedSyncConfig,
  target: string,
  context: Pick<SyncContext, "cwd" | "environment">,
) => {
  const trimmedTarget = target.trim();
  const resolvedTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    context.environment,
    context.cwd,
  );
  const byLocalPath = config.entries.filter((entry) => {
    return entry.localPath === resolvedTargetPath;
  });

  if (byLocalPath.length > 0 || isExplicitLocalPath(trimmedTarget)) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return [];
  }

  return config.entries.filter((entry) => {
    return entry.repoPath === normalizedRepoPath;
  });
};

export const setSyncEntryMode = async (
  request: SyncEntryModeRequest,
  context: SyncContext,
): Promise<SyncSetResult> => {
  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked root path after the mode.",
    });
  }

  const matches = findExactTrackedEntry(config, target, context);

  if (matches.length > 1) {
    throw new DevsyncError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path to choose the tracked root.",
    });
  }

  const matchedEntry = matches[0];

  if (matchedEntry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'devsync track'.",
    });
  }

  const action = matchedEntry.mode === request.state ? "unchanged" : "updated";
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((entry) => {
      if (entry.repoPath !== matchedEntry.repoPath) {
        return entry;
      }

      return {
        ...entry,
        mode: request.state,
      };
    }),
  });

  if (action !== "unchanged") {
    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
    });
  }

  return {
    action,
    configPath: context.paths.configPath,
    entryRepoPath: matchedEntry.repoPath,
    localPath: matchedEntry.localPath,
    mode: request.state,
    repoPath: matchedEntry.repoPath,
    scope: "default",
    syncDirectory: context.paths.syncDirectory,
  };
};
