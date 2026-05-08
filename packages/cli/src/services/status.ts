import type { SyncConfigEntryKind, SyncMode } from "#app/config/sync-schema.ts";
import { requireGitRepository } from "#app/lib/git.ts";
import type { PullPlan } from "./pull.ts";
import {
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
} from "./pull.ts";
import type { PushPlan } from "./push.ts";
import {
  buildPushPlan,
  buildPushPlanPreview,
  buildPushResultFromPlan,
} from "./push.ts";
import {
  buildArtifactKey,
  isRepoArtifactCurrent,
  parseArtifactRelativePath,
} from "./repo-artifacts.ts";
import { loadSyncConfig, resolveSyncPaths } from "./sync-context.ts";

export type StatusEntry = Readonly<{
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  mode: SyncMode;
  repoPath: string;
}>;

export type PushChanges = Readonly<{
  added: readonly string[];
  modified: readonly string[];
  deleted: readonly string[];
}>;

export type PullChanges = Readonly<{
  updated: readonly string[];
  deleted: readonly string[];
}>;

export type StatusResult = Readonly<{
  activeProfile?: string;
  entries: readonly StatusEntry[];
  entryCount: number;
  pull: ReturnType<typeof buildPullResultFromPlan> & {
    changes: PullChanges;
    preview: readonly string[];
  };
  push: ReturnType<typeof buildPushResultFromPlan> & {
    changes: PushChanges;
    preview: readonly string[];
  };
  recipientCount: number;
}>;

const normalizeArtifactKeyToRepoPath = (artifactKey: string) => {
  const relativePath = artifactKey.endsWith("/")
    ? artifactKey.slice(0, -1)
    : artifactKey;

  return parseArtifactRelativePath(relativePath).repoPath;
};

const buildPushChanges = async (
  plan: PushPlan,
  syncDirectory: string,
  identityFile: string,
): Promise<PushChanges> => {
  const added: string[] = [];
  const modified: string[] = [];

  for (const artifact of plan.artifacts) {
    const artifactKey = buildArtifactKey(artifact);

    if (
      await isRepoArtifactCurrent(syncDirectory, artifact, {
        identityFile,
      })
    ) {
      continue;
    }

    if (plan.existingArtifactKeys.has(artifactKey)) {
      modified.push(artifact.repoPath);
    } else {
      added.push(artifact.repoPath);
    }
  }

  const deleted = [...plan.existingArtifactKeys]
    .filter((key) => !plan.desiredArtifactKeys.has(key))
    .map(normalizeArtifactKeyToRepoPath)
    .sort((a, b) => a.localeCompare(b));

  return {
    added: added.sort((a, b) => a.localeCompare(b)),
    modified: modified.sort((a, b) => a.localeCompare(b)),
    deleted,
  };
};

const buildPullChanges = (plan: PullPlan): PullChanges => {
  return {
    updated: [...plan.updatedLocalPaths],
    deleted: [...plan.deletedLocalPaths],
  };
};

export const getStatus = async (
  options: Readonly<{
    profile?: string;
  }> = {},
): Promise<StatusResult> => {
  const { syncDirectory } = resolveSyncPaths();

  await requireGitRepository(syncDirectory);

  const { effectiveConfig, fullConfig } = await loadSyncConfig(
    syncDirectory,
    options,
  );
  const pushPlan = await buildPushPlan(effectiveConfig, syncDirectory);
  const pullPlan = await buildPullPlan(effectiveConfig, syncDirectory);
  const pushChanges = await buildPushChanges(
    pushPlan,
    syncDirectory,
    effectiveConfig.age.identityFile,
  );

  return {
    ...(effectiveConfig.activeProfile === undefined
      ? {}
      : { activeProfile: effectiveConfig.activeProfile }),
    entries: fullConfig.entries.map((entry) => ({
      kind: entry.kind,
      localPath: entry.localPath,
      profiles: entry.profiles,
      mode: entry.mode,
      repoPath: entry.repoPath,
    })),
    entryCount: fullConfig.entries.length,
    pull: {
      ...buildPullResultFromPlan(pullPlan, true),
      changes: buildPullChanges(pullPlan),
      preview: buildPullPlanPreview(pullPlan),
    },
    push: {
      ...buildPushResultFromPlan(pushPlan, true),
      changes: pushChanges,
      preview: buildPushPlanPreview(pushPlan),
    },
    recipientCount: effectiveConfig.age.recipients.length,
  };
};
