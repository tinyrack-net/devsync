import {
  normalizeSyncMachineName,
  readSyncConfig,
  resolveRelativeSyncRule,
} from "#app/config/sync.ts";
import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import {
  resolveSetTarget,
  type SyncSetRequest,
  type SyncSetResult,
  setSyncTargetMode,
} from "./set.ts";

export type SyncRuleSetRequest = SyncSetRequest;

export type SyncRuleUnsetRequest = Readonly<{
  machine?: string;
  recursive: boolean;
  target: string;
}>;

export const setSyncRule = (
  request: SyncRuleSetRequest,
  context: SyncContext,
) => {
  return setSyncTargetMode(request, context);
};

export const unsetSyncRule = async (
  request: SyncRuleUnsetRequest,
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
  const target = await resolveSetTarget(
    request.target,
    machine,
    config,
    context,
  );

  if (target.relativePath === "") {
    throw new DevsyncError(
      "Rule targets must be child paths inside tracked directory roots.",
      {
        code: "TARGET_NOT_TRACKED",
        details: [`Target: ${target.repoPath}`],
        hint: "Use 'devsync entry mode' for tracked roots, or point 'devsync rule unset' at a child path inside a tracked directory.",
      },
    );
  }

  if (target.stats?.isDirectory() && !request.recursive) {
    throw new DevsyncError("Directory targets require --recursive.", {
      code: "RECURSIVE_REQUIRED",
      details: [`Target: ${target.localPath}`],
      hint: "Use '--recursive' for subtree rules, or point at a file for an exact rule.",
    });
  }

  if (
    request.recursive &&
    target.stats !== undefined &&
    !target.stats.isDirectory()
  ) {
    throw new DevsyncError(
      "--recursive can only be used with directories or tracked directory roots.",
      {
        code: "RECURSIVE_INVALID",
        details: [`Target: ${target.localPath}`],
        hint: "Remove '--recursive' when unsetting the rule for a single file.",
      },
    );
  }

  const scope = request.recursive ? "subtree" : "exact";
  const entry =
    machine === undefined || target.entry.machine === machine
      ? target.entry
      : config.entries.find((candidate) => {
          return (
            candidate.repoPath === target.entry.repoPath &&
            candidate.machine === machine
          );
        });

  if (entry === undefined) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: target.entry.mode,
      ...(machine === undefined ? {} : { machine }),
      repoPath: target.repoPath,
      reason: "already-inherited",
      scope,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const nextOverrides = entry.overrides.filter((override) => {
    return !(override.match === scope && override.path === target.relativePath);
  });

  if (nextOverrides.length === entry.overrides.length) {
    return {
      action: "unchanged",
      configPath: context.paths.configPath,
      entryRepoPath: target.entry.repoPath,
      localPath: target.localPath,
      mode: target.entry.mode,
      ...(entry.machine === undefined ? {} : { machine: entry.machine }),
      repoPath: target.repoPath,
      reason: "already-inherited",
      scope,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const baseEntry = config.entries.find((candidate) => {
    return (
      entry.machine !== undefined &&
      candidate.repoPath === entry.repoPath &&
      candidate.machine === undefined
    );
  });
  const inheritedMode =
    resolveRelativeSyncRule(
      baseEntry === undefined
        ? {
            machine: entry.machine,
            mode: entry.mode,
            overrides: nextOverrides,
          }
        : {
            machine: entry.machine,
            mode: baseEntry.mode,
            overrides: [
              ...baseEntry.overrides.filter((override) => {
                return !nextOverrides.some((candidate) => {
                  return (
                    candidate.match === override.match &&
                    candidate.path === override.path
                  );
                });
              }),
              ...nextOverrides,
            ],
          },
      target.relativePath,
      entry.machine,
    )?.mode ?? entry.mode;

  const removeEntry =
    entry.machine !== undefined &&
    nextOverrides.length === 0 &&
    baseEntry !== undefined &&
    entry.mode === baseEntry.mode;
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: removeEntry
      ? config.entries.filter((candidate) => {
          return !(
            candidate.repoPath === entry.repoPath &&
            candidate.machine === entry.machine
          );
        })
      : config.entries.map((candidate) => {
          if (candidate.repoPath !== entry.repoPath) {
            return candidate;
          }

          if (candidate.machine !== entry.machine) {
            return candidate;
          }

          return {
            ...candidate,
            overrides: nextOverrides,
          };
        }),
  });

  await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
    environment: context.environment,
  });

  return {
    action: "removed",
    configPath: context.paths.configPath,
    entryRepoPath: target.entry.repoPath,
    localPath: target.localPath,
    mode: inheritedMode,
    ...(entry.machine === undefined ? {} : { machine: entry.machine }),
    repoPath: target.repoPath,
    reason: "reverted-to-inherited",
    scope,
    syncDirectory: context.paths.syncDirectory,
  };
};
