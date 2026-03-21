import {
  type ResolvedSyncConfig,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync.ts";

import {
  createSyncConfigDocument,
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
    throw new DevsyncError("Sync target does not exist.", {
      code: "TARGET_NOT_FOUND",
      details: [`Target: ${targetPath}`],
      hint: "Create the file or directory first, then run devsync add again.",
    });
  }

  const kind = (() => {
    if (targetStats.isDirectory()) {
      return "directory" as const;
    }

    if (targetStats.isFile() || targetStats.isSymbolicLink()) {
      return "file" as const;
    }

    throw new DevsyncError("Sync target type is not supported.", {
      code: "TARGET_UNSUPPORTED_TYPE",
      details: [`Target: ${targetPath}`],
      hint: "Track a regular file, symlink, or directory.",
    });
  })();

  if (doPathsOverlap(targetPath, context.paths.syncDirectory)) {
    throw new DevsyncError("Sync target overlaps the devsync repository.", {
      code: "TARGET_OVERLAPS_SYNC_DIR",
      details: [
        `Target: ${targetPath}`,
        `Sync directory: ${context.paths.syncDirectory}`,
      ],
      hint: "Choose a path outside the devsync sync directory.",
    });
  }

  if (doPathsOverlap(targetPath, config.age.identityFile)) {
    throw new DevsyncError(
      "Sync target contains the configured age identity file.",
      {
        code: "TARGET_OVERLAPS_IDENTITY",
        details: [
          `Target: ${targetPath}`,
          `Age identity file: ${config.age.identityFile}`,
        ],
        hint: "Store age key material outside tracked sync targets.",
      },
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
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a file or directory path, for example 'devsync add ~/.gitconfig'.",
    });
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
      entry.profile === undefined &&
      (entry.localPath === candidate.localPath ||
        entry.repoPath === candidate.repoPath)
    );
  });
  const overlappingEntry = config.entries.find((entry) => {
    return (
      entry.profile === undefined &&
      entry.localPath !== candidate.localPath &&
      doPathsOverlap(entry.localPath, candidate.localPath)
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
        "Sync target conflicts with an existing tracked entry.",
        {
          code: "TARGET_CONFLICT",
          details: [
            `Requested local path: ${candidate.localPath}`,
            `Requested repo path: ${candidate.repoPath}`,
            `Existing entry: ${existingEntry.localPath} -> ${existingEntry.repoPath}`,
          ],
          hint: "Forget or rename the existing entry before adding an overlapping target.",
        },
      );
    }
  }

  if (overlappingEntry !== undefined) {
    throw new DevsyncError(
      "Sync target conflicts with an existing tracked entry.",
      {
        code: "TARGET_CONFLICT",
        details: [
          `Requested local path: ${candidate.localPath}`,
          `Requested repo path: ${candidate.repoPath}`,
          `Existing entry: ${overlappingEntry.localPath} -> ${overlappingEntry.repoPath}`,
        ],
        hint: "Forget or rename the existing entry before adding an overlapping target.",
      },
    );
  }

  const desiredMode: SyncMode = request.secret ? "secret" : "normal";
  let mode = existingEntry?.mode ?? (request.secret ? "secret" : "normal");
  let nextConfig = createSyncConfigDocument(config);

  if (!alreadyTracked) {
    nextConfig = createSyncConfigDocument({
      ...config,
      entries: [
        ...config.entries,
        {
          ...candidate,
          mode: desiredMode,
        },
      ],
    });
    mode = desiredMode;
  } else if (request.secret && existingEntry?.mode !== "secret") {
    nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== candidate.repoPath) {
          return entry;
        }

        if (entry.profile !== undefined) {
          return entry;
        }

        return {
          ...entry,
          mode: "secret",
        };
      }),
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
