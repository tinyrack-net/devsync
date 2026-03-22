import { resolveConfiguredIdentityFile } from "#app/config/global-config.ts";
import {
  normalizeSyncMachineName,
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
  machines?: readonly string[];
  mode: Extract<SyncMode, "normal" | "secret">;
  target: string;
}>;

export type SyncAddResult = Readonly<{
  alreadyTracked: boolean;
  configPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  machines: readonly string[];
  mode: Extract<SyncMode, "normal" | "secret">;
  repoPath: string;
  syncDirectory: string;
}>;

const buildAddEntryCandidate = async (
  targetPath: string,
  context: Pick<SyncContext, "environment" | "paths">,
  input: Readonly<{
    identityFile: string | undefined;
    machines?: readonly string[];
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

  if (
    input.identityFile !== undefined &&
    doPathsOverlap(targetPath, input.identityFile)
  ) {
    throw new DevsyncError(
      "Sync target contains the configured age identity file.",
      {
        code: "TARGET_OVERLAPS_IDENTITY",
        details: [
          `Target: ${targetPath}`,
          `Age identity file: ${input.identityFile}`,
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
  const configuredLocalPath = buildConfiguredHomeLocalPath(repoPath);

  return {
    configuredLocalPath,
    kind,
    localPath: targetPath,
    machines: input.machines?.map((m) => normalizeSyncMachineName(m)) ?? [],
    mode: input.mode,
    modeExplicit: true,
    name: repoPath,
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
  const identityFile =
    config.age !== undefined
      ? resolveConfiguredIdentityFile(
          config.age.identityFile,
          context.environment,
        )
      : undefined;
  const candidate = await buildAddEntryCandidate(
    resolveCommandTargetPath(target, context.environment, context.cwd),
    context,
    {
      identityFile,
      machines: request.machines,
      mode: request.mode,
    },
  );
  const existingEntry = config.entries.find((entry) => {
    return (
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
  let machines: readonly string[] = candidate.machines;
  let changed = false;

  if (!alreadyTracked) {
    nextConfig = createSyncConfigDocument({
      ...config,
      entries: [...config.entries, candidate],
    });
    mode = candidate.mode;
    changed = true;
  } else {
    const modeChanged = existingEntry?.mode !== request.mode;
    const machinesChanged =
      request.machines !== undefined &&
      (existingEntry?.machines.length !== candidate.machines.length ||
        !candidate.machines.every((m) => existingEntry?.machines.includes(m)));

    if (modeChanged || machinesChanged) {
      nextConfig = createSyncConfigDocument({
        ...config,
        entries: config.entries.map((entry) => {
          if (entry.repoPath !== candidate.repoPath) {
            return entry;
          }

          return {
            ...entry,
            ...(modeChanged ? { mode: request.mode } : {}),
            ...(machinesChanged ? { machines: candidate.machines } : {}),
          };
        }),
      });
      mode = modeChanged ? request.mode : (existingEntry?.mode ?? request.mode);
      changed = true;
    }

    machines = machinesChanged
      ? candidate.machines
      : (existingEntry?.machines ?? []);
  }

  if (changed) {
    await writeValidatedSyncConfig(context.paths.syncDirectory, nextConfig, {
      environment: context.environment,
    });
  }

  return {
    alreadyTracked,
    configPath: context.paths.configPath,
    kind: candidate.kind,
    localPath: candidate.localPath,
    machines,
    mode,
    repoPath: candidate.repoPath,
    syncDirectory: context.paths.syncDirectory,
  };
};
