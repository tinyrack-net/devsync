import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncConfigFilePath,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";
import {
  resolveDevtoolsSyncDirectory,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";

import {
  createSyncConfigDocument,
  createSyncConfigDocumentEntry,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { SyncError } from "./error.ts";
import { getPathStats } from "./filesystem.ts";
import { ensureGitRepository, type GitService } from "./git.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  doPathsOverlap,
  resolveCommandTargetPath,
} from "./paths.ts";

type SyncAddRequest = Readonly<{
  secret: boolean;
  target: string;
}>;

type SyncAddResult = Readonly<{
  alreadyTracked: boolean;
  configPath: string;
  defaultMode: SyncMode;
  kind: SyncConfigEntryKind;
  localPath: string;
  repoPath: string;
  syncDirectory: string;
}>;

const buildAddEntryCandidate = async (
  targetPath: string,
  config: ResolvedSyncConfig,
  environment: NodeJS.ProcessEnv,
) => {
  const targetStats = await getPathStats(targetPath);

  if (targetStats === undefined) {
    throw new SyncError(`Sync target does not exist: ${targetPath}`);
  }

  const kind = (() => {
    if (targetStats.isDirectory()) {
      return "directory" as const;
    }

    if (targetStats.isFile() || targetStats.isSymbolicLink()) {
      return "file" as const;
    }

    throw new SyncError(`Unsupported sync target type: ${targetPath}`);
  })();

  const syncDirectory = resolveDevtoolsSyncDirectory(environment);

  if (doPathsOverlap(targetPath, syncDirectory)) {
    throw new SyncError(
      `Sync target must not overlap the sync directory: ${targetPath}`,
    );
  }

  if (doPathsOverlap(targetPath, config.age.identityFile)) {
    throw new SyncError(
      `Sync target must not contain the age identity file: ${targetPath}`,
    );
  }

  const repoPath = buildRepoPathWithinRoot(
    targetPath,
    resolveHomeDirectory(environment),
    "Sync target",
  );

  return {
    configuredLocalPath: buildConfiguredHomeLocalPath(repoPath),
    defaultMode: "normal",
    kind,
    localPath: targetPath,
    name: repoPath,
    repoPath,
    rules: [],
  } satisfies ResolvedSyncConfigEntry;
};

export const addSyncTarget = async (
  request: SyncAddRequest,
  dependencies: Readonly<{
    cwd: string;
    environment: NodeJS.ProcessEnv;
    git: GitService;
  }>,
): Promise<SyncAddResult> => {
  try {
    const target = request.target.trim();

    if (target.length === 0) {
      throw new SyncError("Target path is required.");
    }

    const syncDirectory = resolveDevtoolsSyncDirectory(
      dependencies.environment,
    );

    await ensureGitRepository(syncDirectory, dependencies.git);

    const config = await readSyncConfig(
      syncDirectory,
      dependencies.environment,
    );
    const candidate = await buildAddEntryCandidate(
      resolveCommandTargetPath(
        target,
        dependencies.environment,
        dependencies.cwd,
      ),
      config,
      dependencies.environment,
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
        throw new SyncError(
          `Sync target conflicts with an existing entry: ${existingEntry.repoPath}`,
        );
      }
    }

    const nextConfig = createSyncConfigDocument(config);
    const desiredDefaultMode: SyncMode = request.secret ? "secret" : "normal";
    let defaultMode =
      existingEntry?.defaultMode ?? (request.secret ? "secret" : "normal");

    if (!alreadyTracked) {
      nextConfig.entries = sortSyncConfigEntries([
        ...nextConfig.entries,
        createSyncConfigDocumentEntry({
          ...candidate,
          defaultMode: desiredDefaultMode,
        }),
      ]);
      defaultMode = desiredDefaultMode;
    } else if (request.secret && existingEntry?.defaultMode !== "secret") {
      nextConfig.entries = nextConfig.entries.map((entry) => {
        if (entry.repoPath !== candidate.repoPath) {
          return entry;
        }

        return {
          ...entry,
          defaultMode: "secret",
        };
      });

      defaultMode = "secret";
    }

    if (
      !alreadyTracked ||
      (request.secret && existingEntry?.defaultMode !== "secret")
    ) {
      await writeValidatedSyncConfig(
        syncDirectory,
        nextConfig,
        dependencies.environment,
      );
    }

    return {
      alreadyTracked,
      configPath: resolveSyncConfigFilePath(syncDirectory),
      defaultMode,
      kind: candidate.kind,
      localPath: candidate.localPath,
      repoPath: candidate.repoPath,
      syncDirectory,
    };
  } catch (error: unknown) {
    if (error instanceof SyncError) {
      throw error;
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Sync add failed.",
    );
  }
};
