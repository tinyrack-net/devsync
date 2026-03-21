import {
  normalizeSyncMachineName,
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
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
  machine?: string;
  state: SyncMode;
  target: string;
}>;

const findExactTrackedEntry = (
  config: ResolvedSyncConfig,
  target: string,
  machine: string | undefined,
  context: Pick<SyncContext, "cwd" | "environment">,
) => {
  const trimmedTarget = target.trim();
  const resolvedTargetPath = resolveCommandTargetPath(
    trimmedTarget,
    context.environment,
    context.cwd,
  );
  const byLocalPath = config.entries.filter((entry) => {
    return entry.localPath === resolvedTargetPath && entry.machine === machine;
  });

  if (byLocalPath.length > 0 || isExplicitLocalPath(trimmedTarget)) {
    return byLocalPath;
  }

  const normalizedRepoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (normalizedRepoPath === undefined) {
    return [];
  }

  return config.entries.filter((entry) => {
    return entry.repoPath === normalizedRepoPath && entry.machine === machine;
  });
};

export const setSyncEntryMode = async (
  request: SyncEntryModeRequest,
  context: SyncContext,
): Promise<SyncSetResult> => {
  await ensureSyncRepository(context);

  const machine =
    request.machine === undefined
      ? undefined
      : normalizeSyncMachineName(request.machine);
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

  const matches = findExactTrackedEntry(config, target, machine, context);

  if (matches.length > 1) {
    throw new DevsyncError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path to choose the tracked root.",
    });
  }

  const matchedEntry = matches[0];
  const nextEntry =
    matchedEntry ??
    (() => {
      if (machine === undefined) {
        return undefined;
      }

      const baseMatches = findExactTrackedEntry(
        config,
        target,
        undefined,
        context,
      );
      const baseEntry = baseMatches[0];

      if (baseMatches.length > 1) {
        throw new DevsyncError(
          `Multiple tracked sync entries match: ${target}`,
          {
            code: "TARGET_CONFLICT",
            hint: "Use an explicit local path to choose the tracked root.",
          },
        );
      }

      if (baseEntry === undefined) {
        return undefined;
      }

      return {
        ...baseEntry,
        machine,
        mode: request.state,
        modeExplicit: true,
        name: `${baseEntry.repoPath}#${machine}`,
        overrides: [],
      } satisfies ResolvedSyncConfigEntry;
    })();

  if (nextEntry === undefined) {
    throw new DevsyncError(`No tracked sync entry matches: ${target}`, {
      code: "TARGET_NOT_TRACKED",
      hint: "Track the root first with 'devsync track'.",
    });
  }

  const action =
    matchedEntry === undefined
      ? "added"
      : matchedEntry.mode === request.state
        ? "unchanged"
        : "updated";
  const nextConfig =
    action === "added"
      ? createSyncConfigDocument({
          ...config,
          entries: [...config.entries, nextEntry],
        })
      : createSyncConfigDocument({
          ...config,
          entries: config.entries.map((entry) => {
            if (entry.repoPath !== nextEntry.repoPath) {
              return entry;
            }

            if (entry.machine !== nextEntry.machine) {
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
    entryRepoPath: nextEntry.repoPath,
    localPath: nextEntry.localPath,
    mode: request.state,
    ...(machine === undefined ? {} : { machine }),
    repoPath: nextEntry.repoPath,
    scope: "default",
    syncDirectory: context.paths.syncDirectory,
  };
};
