import { isAbsolute, join, posix, relative, resolve } from "node:path";
import {
  findOwningSyncEntry,
  normalizeSyncRepoPath,
  type PlatformSyncMode,
  type ResolvedSyncConfigEntry,
  readSyncConfig,
  resolveEntryRelativeRepoPath,
  type SyncMode,
} from "#app/config/sync.ts";
import { expandHomePath } from "#app/config/xdg.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { getPathStats } from "#app/lib/filesystem.ts";
import { ensureGitRepository } from "#app/lib/git.ts";
import { isExplicitLocalPath } from "#app/lib/path.ts";
import {
  createSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "./paths.ts";
import {
  resolveSyncConfigResolutionContext,
  resolveSyncPaths,
} from "./runtime.ts";

export type SetModeRequest = Readonly<{
  mode: SyncMode;
  target: string;
}>;

type SyncSetAction = "added" | "removed" | "unchanged" | "updated";
type SyncSetReason = "already-set";

export type SetModeResult = Readonly<{
  action: SyncSetAction;
  configPath: string;
  entryRepoPath: string;
  localPath: string;
  mode: SyncMode;
  repoPath: string;
  reason?: SyncSetReason;
  syncDirectory: string;
}>;

const buildDefaultPlatformMode = (mode: SyncMode): PlatformSyncMode => ({
  default: mode,
});

const buildDefaultConfiguredRepoPath = (repoPath: string) => ({
  default: normalizeSyncRepoPath(repoPath),
});

const hasPlatformSpecificModeOverride = (configuredMode: PlatformSyncMode) => {
  return (
    configuredMode.win !== undefined ||
    configuredMode.mac !== undefined ||
    configuredMode.linux !== undefined ||
    configuredMode.wsl !== undefined
  );
};

const computeLocalPath = (entry: ResolvedSyncConfigEntry, repoPath: string) => {
  const relativePath = resolveEntryRelativeRepoPath(entry, repoPath);
  if (relativePath === undefined || relativePath === "") {
    return entry.localPath;
  }
  return join(entry.localPath, ...relativePath.split("/"));
};

const resolveRelativeLocalPath = (rootPath: string, targetPath: string) => {
  const relativePath = relative(rootPath, targetPath);

  if (relativePath === "") {
    return "";
  }

  if (
    isAbsolute(relativePath) ||
    relativePath.startsWith("..") ||
    relativePath === ".."
  ) {
    return undefined;
  }

  return relativePath.replaceAll("\\", "/");
};

const findOwningLocalEntry = (
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  localPath: string,
) => {
  let best: ResolvedSyncConfigEntry | undefined;

  for (const entry of config.entries) {
    if (entry.kind !== "directory") {
      continue;
    }

    const relativeLocalPath = resolveRelativeLocalPath(
      entry.localPath,
      localPath,
    );

    if (
      relativeLocalPath === undefined ||
      relativeLocalPath === "" ||
      (best !== undefined && entry.localPath.length <= best.localPath.length)
    ) {
      continue;
    }

    best = entry;
  }

  return best;
};

export const resolveSetTarget = async (
  target: string,
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  cwd: string,
  homeDirectory: string,
) => {
  const trimmedTarget = target.trim();

  if (trimmedTarget.length === 0) {
    throw new DevsyncError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a tracked path, for example 'devsync mode ~/.ssh/id_ed25519 secret'.",
    });
  }

  const explicit = isExplicitLocalPath(trimmedTarget);
  const localTargetPath = resolve(
    cwd,
    expandHomePath(trimmedTarget, homeDirectory),
  );
  const localRepoPath = explicit
    ? buildRepoPathWithinRoot(localTargetPath, homeDirectory, "Sync set target")
    : tryBuildRepoPathWithinRoot(
        localTargetPath,
        homeDirectory,
        "Sync set target",
      );

  // Phase 1: Try resolving as a local path
  if (localRepoPath !== undefined) {
    const localStats = await getPathStats(localTargetPath);

    if (explicit && localStats === undefined) {
      throw new DevsyncError("Sync set target does not exist.", {
        code: "TARGET_NOT_FOUND",
        details: [`Target: ${localTargetPath}`],
        hint: "Use an existing local path, or pass a repository path inside a tracked directory.",
      });
    }

    const exactEntry = config.entries.find((e) => e.repoPath === localRepoPath);

    if (exactEntry !== undefined) {
      const localPath = computeLocalPath(exactEntry, localRepoPath);

      return {
        entry: exactEntry,
        localPath,
        relativePath: "",
        repoPath: localRepoPath,
        stats:
          localPath === localTargetPath
            ? localStats
            : await getPathStats(localPath),
      };
    }

    const parentEntry = findOwningSyncEntry(config, localRepoPath);

    if (parentEntry?.kind === "directory") {
      const relativePath = resolveEntryRelativeRepoPath(
        parentEntry,
        localRepoPath,
      );

      if (relativePath !== undefined) {
        const localPath = computeLocalPath(parentEntry, localRepoPath);

        return {
          entry: parentEntry,
          localPath,
          relativePath,
          repoPath: localRepoPath,
          stats:
            localPath === localTargetPath
              ? localStats
              : await getPathStats(localPath),
        };
      }
    }

    const exactLocalEntry = config.entries.find(
      (entry) => entry.localPath === localTargetPath,
    );

    if (exactLocalEntry !== undefined) {
      return {
        entry: exactLocalEntry,
        localPath: localTargetPath,
        relativePath: "",
        repoPath: exactLocalEntry.repoPath,
        stats: localStats,
      };
    }

    const localParentEntry = findOwningLocalEntry(config, localTargetPath);

    if (localParentEntry !== undefined) {
      const relativePath = resolveRelativeLocalPath(
        localParentEntry.localPath,
        localTargetPath,
      );

      if (relativePath !== undefined && relativePath !== "") {
        return {
          entry: localParentEntry,
          localPath: localTargetPath,
          relativePath,
          repoPath: posix.join(localParentEntry.repoPath, relativePath),
          stats: localStats,
        };
      }
    }

    if (explicit) {
      throw new DevsyncError(
        "Local set target is not inside a tracked directory entry.",
        {
          code: "TARGET_NOT_TRACKED",
          details: [`Target: ${trimmedTarget}`],
          hint: "Track the parent directory first with 'devsync track', then use 'devsync mode' on the child path.",
        },
      );
    }
  }

  // Phase 2: Fallback to repo path resolution
  const repoPath = tryNormalizeRepoPathInput(trimmedTarget);

  if (repoPath === undefined) {
    throw new DevsyncError(
      "Sync set target is not a valid local or repository path.",
      {
        code: "INVALID_SET_TARGET",
        details: [`Target: ${trimmedTarget}`],
        hint: "Use an absolute path, a cwd-relative path, or a repository path like '.config/tool/file.json'.",
      },
    );
  }

  const exactEntry = config.entries.find((e) => e.repoPath === repoPath);

  if (exactEntry !== undefined) {
    const localPath = computeLocalPath(exactEntry, repoPath);

    return {
      entry: exactEntry,
      localPath,
      relativePath: "",
      repoPath,
      stats: await getPathStats(localPath),
    };
  }

  const entry = findOwningSyncEntry(config, repoPath);
  const relativePath =
    entry?.kind === "directory"
      ? resolveEntryRelativeRepoPath(entry, repoPath)
      : undefined;

  if (entry === undefined || relativePath === undefined) {
    throw new DevsyncError(
      "Repository set target is not inside a tracked directory entry.",
      {
        code: "TARGET_NOT_TRACKED",
        details: [`Target: ${trimmedTarget}`],
        hint: "Use a repository path under an existing tracked directory, or track it first with 'devsync track'.",
      },
    );
  }

  const localPath = computeLocalPath(entry, repoPath);

  return {
    entry,
    localPath,
    relativePath,
    repoPath,
    stats: await getPathStats(localPath),
  };
};

export const setTargetMode = async (
  request: SetModeRequest,
  cwd: string,
): Promise<SetModeResult> => {
  const { syncDirectory, configPath } = resolveSyncPaths();
  const context = resolveSyncConfigResolutionContext();

  await ensureGitRepository(syncDirectory);

  const config = await readSyncConfig(syncDirectory, context);
  const target = await resolveSetTarget(
    request.target,
    config,
    cwd,
    context.homeDirectory,
  );

  const buildResult = (
    action: SyncSetAction,
    extras?: Partial<SetModeResult>,
  ): SetModeResult => ({
    action,
    configPath,
    entryRepoPath: target.entry.repoPath,
    localPath: target.localPath,
    mode: request.mode,
    repoPath: target.repoPath,
    syncDirectory,
    ...extras,
  });

  if (target.relativePath === "") {
    const nextConfiguredMode = buildDefaultPlatformMode(request.mode);
    const action =
      target.entry.mode === request.mode &&
      target.entry.configuredMode.default === request.mode &&
      !hasPlatformSpecificModeOverride(target.entry.configuredMode)
        ? "unchanged"
        : "updated";
    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== target.entry.repoPath) {
          return entry;
        }

        return {
          ...entry,
          configuredMode: nextConfiguredMode,
          mode: request.mode,
        };
      }),
    });

    if (action !== "unchanged") {
      await writeValidatedSyncConfig(syncDirectory, nextConfig, context);
    }

    return buildResult(action);
  }

  const childKind = target.stats?.isDirectory() ? "directory" : "file";
  const childRepoPath = target.repoPath;
  const childLocalRelativePath = resolveRelativeLocalPath(
    context.homeDirectory,
    target.localPath,
  );

  if (childLocalRelativePath === undefined || childLocalRelativePath === "") {
    throw new DevsyncError(
      "Sync set target must stay inside the configured home root.",
      {
        code: "TARGET_OUTSIDE_ROOT",
        details: [
          `Target: ${target.localPath}`,
          `Allowed root: ${context.homeDirectory}`,
        ],
        hint: `Use a path inside ${context.homeDirectory}.`,
      },
    );
  }

  const childConfiguredLocalPath = buildConfiguredHomeLocalPath(
    childLocalRelativePath,
  );
  const childConfiguredRepoPath =
    childRepoPath === childLocalRelativePath ? undefined : childRepoPath;

  const existingChild = config.entries.find(
    (e) => e.repoPath === childRepoPath,
  );

  if (existingChild !== undefined) {
    if (
      existingChild.mode === request.mode &&
      existingChild.configuredMode.default === request.mode &&
      !hasPlatformSpecificModeOverride(existingChild.configuredMode)
    ) {
      return buildResult("unchanged", { reason: "already-set" });
    }

    const nextConfiguredMode = buildDefaultPlatformMode(request.mode);

    const nextConfig = createSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.repoPath !== childRepoPath) {
          return entry;
        }

        return {
          ...entry,
          configuredMode: nextConfiguredMode,
          mode: request.mode,
        };
      }),
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig, context);

    return buildResult("updated");
  }

  if (request.mode === target.entry.mode) {
    return buildResult("unchanged");
  }

  const newEntry: ResolvedSyncConfigEntry = {
    configuredLocalPath: childConfiguredLocalPath,
    kind: childKind,
    localPath: target.localPath,
    ...(childConfiguredRepoPath === undefined
      ? {}
      : {
          configuredRepoPath: buildDefaultConfiguredRepoPath(
            childConfiguredRepoPath,
          ),
        }),
    profiles: [],
    profilesExplicit: false,
    mode: request.mode,
    modeExplicit: true,
    configuredMode: buildDefaultPlatformMode(request.mode),
    permissionExplicit: false,
    repoPath: childRepoPath,
  };

  const nextConfig = createSyncConfigDocument({
    ...config,
    entries: [...config.entries, newEntry],
  });

  await writeValidatedSyncConfig(syncDirectory, nextConfig, context);

  return buildResult("added");
};
