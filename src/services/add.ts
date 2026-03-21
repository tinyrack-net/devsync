import {
  normalizeSyncMachineName,
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
  machine?: string;
  mode: Extract<SyncMode, "normal" | "secret">;
  target: string;
}>;

export type SyncAddResult = Readonly<{
  alreadyTracked: boolean;
  configPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  machine?: string;
  mode: Extract<SyncMode, "normal" | "secret">;
  repoPath: string;
  syncDirectory: string;
}>;

const buildAddEntryCandidate = async (
  targetPath: string,
  config: ResolvedSyncConfig,
  context: Pick<SyncContext, "paths">,
  input: Readonly<{
    machine?: string;
    mode: Extract<SyncMode, "normal" | "secret">;
  }>,
) => {
  const targetStats = await getPathStats(targetPath);

  if (targetStats === undefined) {
    throw new DevsyncError("Sync target does not exist.", {
      code: "TARGET_NOT_FOUND",
      details: [`Target: ${targetPath}`],
      hint: "Create the file or directory first, then run the command again.",
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
    mode: input.mode,
    modeExplicit: true,
    name:
      input.machine === undefined ? repoPath : `${repoPath}#${input.machine}`,
    overrides: [],
    ...(input.machine === undefined ? {} : { machine: input.machine }),
    repoPath,
  } satisfies ResolvedSyncConfigEntry;
};

export const addSyncTarget = async (
  request: Readonly<{
    secret: boolean;
    target: string;
  }>,
  context: SyncContext,
) => {
  return trackSyncTarget(
    {
      mode: request.secret ? "secret" : "normal",
      target: request.target,
    },
    context,
  );
};

export const trackSyncTarget = async (
  request: SyncAddRequest,
  context: SyncContext,
): Promise<SyncAddResult> => {
  const target = request.target.trim();
  const machine =
    request.machine === undefined
      ? undefined
      : normalizeSyncMachineName(request.machine);

  if (target.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a file or directory path, for example 'devsync track ~/.gitconfig'.",
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
    {
      ...(machine === undefined ? {} : { machine }),
      mode: request.mode,
    },
  );
  const existingEntry = config.entries.find((entry) => {
    return (
      entry.machine === machine &&
      entry.localPath === candidate.localPath &&
      entry.repoPath === candidate.repoPath
    );
  });
  const alreadyTracked =
    existingEntry !== undefined && existingEntry.kind === candidate.kind;

  if (existingEntry !== undefined && existingEntry.kind !== candidate.kind) {
    throw new DevsyncError(
      "Sync target conflicts with an existing tracked entry.",
      {
        code: "TARGET_CONFLICT",
        details: [
          `Requested local path: ${candidate.localPath}`,
          `Requested repo path: ${candidate.repoPath}`,
          `Existing entry: ${existingEntry.localPath} -> ${existingEntry.repoPath}`,
        ],
        hint: "Untrack or rename the existing entry before adding this root.",
      },
    );
  }

  let nextConfig = createSyncConfigDocument(config);
  let mode: Extract<SyncMode, "normal" | "secret"> = request.mode;

  if (!alreadyTracked) {
    nextConfig = createSyncConfigDocument({
      ...config,
      entries: [...config.entries, candidate],
    });
    mode = candidate.mode;
  } else if (existingEntry?.mode !== request.mode) {
    nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== candidate.repoPath) {
          return entry;
        }

        if (entry.machine !== machine) {
          return entry;
        }

        return {
          ...entry,
          mode: request.mode,
        };
      }),
    });
    mode = request.mode;
  }

  if (!alreadyTracked || existingEntry?.mode !== request.mode) {
    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
    });
  }

  return {
    alreadyTracked,
    configPath: context.paths.configPath,
    kind: candidate.kind,
    localPath: candidate.localPath,
    ...(machine === undefined ? {} : { machine }),
    mode,
    repoPath: candidate.repoPath,
    syncDirectory: context.paths.syncDirectory,
  };
};
