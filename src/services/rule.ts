import { readSyncConfig, resolveRelativeSyncMode } from "#app/config/sync.ts";
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

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const target = await resolveSetTarget(request.target, config, context);

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
  const entry = target.entry;
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
      repoPath: target.repoPath,
      reason: "already-inherited",
      scope,
      syncDirectory: context.paths.syncDirectory,
    };
  }

  const inheritedMode = resolveRelativeSyncMode(
    entry.mode,
    nextOverrides,
    target.relativePath,
  );
  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: config.entries.map((candidate) => {
      if (candidate.repoPath !== entry.repoPath) {
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
    repoPath: target.repoPath,
    reason: "reverted-to-inherited",
    scope,
    syncDirectory: context.paths.syncDirectory,
  };
};
