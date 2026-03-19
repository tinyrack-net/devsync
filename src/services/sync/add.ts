import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveSyncConfigFilePath,
  type SyncConfigEntryKind,
} from "#app/config/sync.ts";
import {
  resolveDevtoolsSyncDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";

import {
  addCanonicalEntrySecretGlob,
  createSyncConfigDocument,
  createSyncConfigDocumentEntry,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { SyncError } from "./error.ts";
import { getPathStats } from "./filesystem.ts";
import { ensureGitRepository, type GitService } from "./git.ts";
import {
  buildConfiguredXdgLocalPath,
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
  kind: SyncConfigEntryKind;
  localPath: string;
  repoPath: string;
  secretGlobAdded: boolean;
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
    resolveXdgConfigHome(environment),
    "Sync target",
  );

  return {
    configuredLocalPath: buildConfiguredXdgLocalPath(repoPath),
    ignoreGlobs: [],
    kind,
    localPath: targetPath,
    name: repoPath,
    repoPath,
    secretGlobs: [],
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

    let secretGlobAdded = false;
    const nextConfig = createSyncConfigDocument(config);

    if (!alreadyTracked) {
      nextConfig.entries = sortSyncConfigEntries([
        ...nextConfig.entries,
        createSyncConfigDocumentEntry(candidate),
      ]);
    }

    if (request.secret) {
      nextConfig.entries = nextConfig.entries.map((entry) => {
        if (entry.repoPath !== candidate.repoPath) {
          return entry;
        }

        const secretGlobResult = addCanonicalEntrySecretGlob(entry);

        secretGlobAdded = secretGlobResult.added;

        return secretGlobResult.entry;
      });
    }

    if (!alreadyTracked || secretGlobAdded) {
      await writeValidatedSyncConfig(
        syncDirectory,
        nextConfig,
        dependencies.environment,
      );
    }

    return {
      alreadyTracked,
      configPath: resolveSyncConfigFilePath(syncDirectory),
      kind: candidate.kind,
      localPath: candidate.localPath,
      repoPath: candidate.repoPath,
      secretGlobAdded,
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
