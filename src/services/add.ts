import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
  createSyncConfigDocumentEntry,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { DevsyncError } from "./error.ts";
import { getPathStats } from "./filesystem.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  doPathsOverlap,
  resolveCommandTargetPath,
} from "./paths.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

export type SyncAddRequest = Readonly<{
  secret: boolean;
  target: string;
}>;

export type SyncAddResult = Readonly<{
  alreadyTracked: boolean;
  configPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  mode: SyncMode;
  repoPath: string;
  syncDirectory: string;
}>;

const buildAddEntryCandidate = async (
  targetPath: string,
  config: ResolvedSyncConfig,
  context: Pick<SyncContext, "paths">,
) => {
  const targetStats = await getPathStats(targetPath);

  if (targetStats === undefined) {
    throw new DevsyncError(`Sync target does not exist: ${targetPath}`);
  }

  const kind = (() => {
    if (targetStats.isDirectory()) {
      return "directory" as const;
    }

    if (targetStats.isFile() || targetStats.isSymbolicLink()) {
      return "file" as const;
    }

    throw new DevsyncError(`Unsupported sync target type: ${targetPath}`);
  })();

  if (doPathsOverlap(targetPath, context.paths.syncDirectory)) {
    throw new DevsyncError(
      `Sync target must not overlap the sync directory: ${targetPath}`,
    );
  }

  if (doPathsOverlap(targetPath, config.age.identityFile)) {
    throw new DevsyncError(
      `Sync target must not contain the age identity file: ${targetPath}`,
    );
  }

  const repoPath = buildRepoPathWithinRoot(
    targetPath,
    context.paths.homeDirectory,
    "Sync target",
  );

  return {
    configuredLocalPath: buildConfiguredHomeLocalPath(repoPath),
    kind,
    localPath: targetPath,
    mode: "normal",
    name: repoPath,
    overrides: [],
    repoPath,
  } satisfies ResolvedSyncConfigEntry;
};

export const addSyncTarget = async (
  request: SyncAddRequest,
  context: SyncContext,
): Promise<SyncAddResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.");
  }

  await ensureSyncRepository(context);

  const config = await readSyncConfig(
    context.paths.syncDirectory,
    context.environment,
  );
  const candidate = await buildAddEntryCandidate(
    resolveCommandTargetPath(target, context.environment, context.cwd),
    config,
    context,
  );
  const existingEntry = config.entries.find((entry) => {
    return (
      entry.localPath === candidate.localPath ||
      entry.repoPath === candidate.repoPath
    );
  });
  let alreadyTracked = false;

  if (existingEntry !== undefined) {
    if (
      existingEntry.localPath === candidate.localPath &&
      existingEntry.repoPath === candidate.repoPath &&
      existingEntry.kind === candidate.kind
    ) {
      alreadyTracked = true;
    } else {
      throw new DevsyncError(
        `Sync target conflicts with an existing entry: ${existingEntry.repoPath}`,
      );
    }
  }

  const nextConfig = createSyncConfigDocument(config);
  const desiredMode: SyncMode = request.secret ? "secret" : "normal";
  let mode = existingEntry?.mode ?? (request.secret ? "secret" : "normal");

  if (!alreadyTracked) {
    nextConfig.entries = sortSyncConfigEntries([
      ...nextConfig.entries,
      createSyncConfigDocumentEntry({
        ...candidate,
        mode: desiredMode,
      }),
    ]);
    mode = desiredMode;
  } else if (request.secret && existingEntry?.mode !== "secret") {
    nextConfig.entries = nextConfig.entries.map((entry) => {
      if (entry.repoPath !== candidate.repoPath) {
        return entry;
      }

      return {
        ...entry,
        mode: "secret",
      };
    });

    mode = "secret";
  }

  if (!alreadyTracked || (request.secret && existingEntry?.mode !== "secret")) {
    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
    });
  }

  return {
    alreadyTracked,
    configPath: context.paths.configPath,
    kind: candidate.kind,
    localPath: candidate.localPath,
    mode,
    repoPath: candidate.repoPath,
    syncDirectory: context.paths.syncDirectory,
  };
};
