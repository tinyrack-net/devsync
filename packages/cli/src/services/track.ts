import { resolve } from "node:path";

import { AppConstants } from "#app/config/constants.ts";
import { resolveDefaultIdentityFile } from "#app/config/identity-file.ts";
import {
  type PlatformKey,
  type PlatformStringValue,
  resolvePlatformValue,
} from "#app/config/platform.ts";
import { resolveDotweaveHomeDirectoryFromEnv } from "#app/config/runtime-env.ts";
import { buildDefaultPlatformMode } from "#app/config/sync-queries.ts";
import {
  normalizeSyncProfileName,
  normalizeSyncRepoPath,
  type PlatformPermission,
  type PlatformSyncMode,
  type ResolvedSyncConfigEntry,
  type SyncConfigEntryKind,
  type SyncMode,
} from "#app/config/sync-schema.ts";
import { expandHomePath } from "#app/config/xdg.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { parsePermissionOctal } from "#app/lib/file-mode.ts";
import { getPathStats } from "#app/lib/filesystem.ts";
import { doPathsOverlap } from "#app/lib/path.ts";
import {
  buildSyncConfigDocument,
  writeValidatedSyncConfig,
} from "./config-file.ts";
import { loadWritableSyncConfig } from "./sync-context.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
} from "./sync-paths.ts";

export type TrackRequest = Readonly<{
  kind?: SyncConfigEntryKind;
  localPathOverrides?: Partial<PlatformStringValue>;
  profiles?: readonly string[];
  mode?: SyncMode | Partial<PlatformSyncMode>;
  permission?: PlatformPermission;
  repoPath?: Partial<PlatformStringValue>;
  target: string;
}>;

export type TrackResult = Readonly<{
  alreadyTracked: boolean;
  changed: boolean;
  configuredLocalPath: PlatformStringValue;
  configuredMode: PlatformSyncMode;
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  mode: SyncMode;
  permission?: number;
  configuredPermission?: PlatformPermission;
  configuredRepoPath?: PlatformStringValue;
  repoPath: string;
}>;

const platformKeys = ["default", "win", "mac", "linux", "wsl"] as const;

const normalizePlatformRepoPath = (
  repoPath: Partial<PlatformStringValue>,
): Partial<PlatformStringValue> => {
  const normalized: Partial<Record<(typeof platformKeys)[number], string>> = {};

  for (const key of platformKeys) {
    if (repoPath[key] !== undefined) {
      normalized[key] = normalizeSyncRepoPath(repoPath[key]);
    }
  }

  return normalized as Partial<PlatformStringValue>;
};

const resolvePlatformMode = (
  configuredMode: PlatformSyncMode,
  platformKey: PlatformKey,
): SyncMode => {
  if (platformKey === "wsl") {
    return configuredMode.wsl ?? configuredMode.linux ?? configuredMode.default;
  }

  return configuredMode[platformKey] ?? configuredMode.default;
};

const buildConfiguredMode = (
  requestedMode: SyncMode | Partial<PlatformSyncMode> | undefined,
  existingMode?: PlatformSyncMode,
): PlatformSyncMode => {
  const base =
    existingMode ?? buildDefaultPlatformMode(AppConstants.SYNC.MODES[0]);
  const patch =
    requestedMode === undefined
      ? {}
      : typeof requestedMode === "string"
        ? buildDefaultPlatformMode(requestedMode)
        : requestedMode;

  return { ...base, ...patch };
};

const mergePlatformStringValue = (
  base: PlatformStringValue,
  patch: Partial<PlatformStringValue>,
): PlatformStringValue => {
  return { ...base, ...patch };
};

const resolveTargetKind = (
  targetPath: string,
  targetStats: Awaited<ReturnType<typeof getPathStats>>,
  requestedKind: SyncConfigEntryKind | undefined,
): SyncConfigEntryKind => {
  if (targetStats === undefined) {
    if (requestedKind !== undefined) {
      return requestedKind;
    }

    throw new DotweaveError("Sync target kind is required.", {
      code: "TARGET_KIND_REQUIRED",
      details: [`Target: ${targetPath}`],
      hint: "Pass --kind file or --kind directory when tracking a path that does not exist yet.",
    });
  }

  const actualKind = (() => {
    if (targetStats.isDirectory()) {
      return "directory" as const;
    }

    if (targetStats.isFile() || targetStats.isSymbolicLink()) {
      return "file" as const;
    }

    throw new DotweaveError("Sync target type is not supported.", {
      code: "TARGET_UNSUPPORTED_TYPE",
      details: [`Target: ${targetPath}`],
      hint: "Track a regular file, symlink, or directory.",
    });
  })();

  if (requestedKind !== undefined && requestedKind !== actualKind) {
    throw new DotweaveError("Sync target kind does not match the path.", {
      code: "TARGET_KIND_MISMATCH",
      details: [
        `Target: ${targetPath}`,
        `Requested kind: ${requestedKind}`,
        `Actual kind: ${actualKind}`,
      ],
      hint: `Use --kind ${actualKind} for this target, or choose a matching path.`,
    });
  }

  return actualKind;
};

const buildTrackEntryCandidate = async (
  targetPath: string,
  syncDirectory: string,
  homeDirectory: string,
  input: Readonly<{
    identityFile: string | undefined;
    kind?: SyncConfigEntryKind;
    localPathOverrides?: Partial<PlatformStringValue>;
    profiles?: readonly string[];
    mode?: SyncMode | Partial<PlatformSyncMode>;
    permission?: PlatformPermission;
    platformKey: PlatformKey;
    repoPath?: Partial<PlatformStringValue>;
  }>,
) => {
  const targetStats = await getPathStats(targetPath);
  const kind = resolveTargetKind(targetPath, targetStats, input.kind);

  if (doPathsOverlap(targetPath, syncDirectory)) {
    throw new DotweaveError(
      "Sync target overlaps the dotweave sync directory.",
      {
        code: "TARGET_OVERLAPS_SYNC_DIR",
        details: [`Target: ${targetPath}`, `Sync directory: ${syncDirectory}`],
        hint: "Choose a path outside the dotweave sync directory.",
      },
    );
  }

  if (
    input.identityFile !== undefined &&
    doPathsOverlap(targetPath, input.identityFile)
  ) {
    throw new DotweaveError(
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

  const localRepoPath = buildRepoPathWithinRoot(
    targetPath,
    homeDirectory,
    "Sync target",
  );
  const configuredLocalPath = mergePlatformStringValue(
    buildConfiguredHomeLocalPath(localRepoPath),
    input.localPathOverrides ?? {},
  );
  const configuredRepoPath =
    input.repoPath === undefined
      ? undefined
      : (normalizePlatformRepoPath({
          default: localRepoPath,
          ...input.repoPath,
        }) as PlatformStringValue);
  const repoPath =
    configuredRepoPath === undefined
      ? localRepoPath
      : resolvePlatformValue(configuredRepoPath, input.platformKey);
  const configuredPermission = input.permission;
  const configuredMode = buildConfiguredMode(input.mode);

  return {
    configuredLocalPath,
    ...(configuredRepoPath === undefined ? {} : { configuredRepoPath }),
    ...(configuredPermission === undefined
      ? {}
      : {
          configuredPermission,
          permission: parsePermissionOctal(configuredPermission.default),
        }),
    kind,
    localPath: targetPath,
    profiles: input.profiles?.map((m) => normalizeSyncProfileName(m)) ?? [],
    profilesExplicit: input.profiles !== undefined,
    mode: resolvePlatformMode(configuredMode, input.platformKey),
    modeExplicit: true,
    configuredMode,
    permissionExplicit: configuredPermission !== undefined,
    repoPath,
  } satisfies ResolvedSyncConfigEntry;
};

const validateRequestedProfiles = (
  requestedProfiles: readonly string[] | undefined,
  availableProfiles: readonly string[] = [],
) => {
  if (requestedProfiles === undefined) {
    return;
  }

  const knownProfiles = new Set([
    AppConstants.SYNC.DEFAULT_PROFILE,
    ...availableProfiles,
  ]);

  for (const profile of requestedProfiles) {
    const normalizedProfile = normalizeSyncProfileName(profile);

    if (!knownProfiles.has(normalizedProfile)) {
      throw new DotweaveError(`Unknown profile '${normalizedProfile}'.`, {
        code: "UNKNOWN_PROFILE",
        hint: `Add it with 'dotweave profile add ${normalizedProfile}', or choose an existing profile.`,
      });
    }
  }
};

export const trackTarget = async (
  request: TrackRequest,
  cwd: string,
): Promise<TrackResult> => {
  const target = request.target.trim();

  if (target.length === 0) {
    throw new DotweaveError("Target path is required.", {
      code: "TARGET_REQUIRED",
      hint: "Pass a file or directory path, for example 'dotweave track ~/.gitconfig'.",
    });
  }

  const { config, context, syncDirectory } = await loadWritableSyncConfig();
  const identityFile =
    config.age !== undefined
      ? resolveDefaultIdentityFile(resolveDotweaveHomeDirectoryFromEnv())
      : undefined;
  const isProfileClear =
    request.profiles !== undefined &&
    request.profiles.length === 1 &&
    request.profiles[0] === "";
  const effectiveProfiles = isProfileClear ? [] : request.profiles;
  validateRequestedProfiles(effectiveProfiles, config.profiles);

  const candidate = await buildTrackEntryCandidate(
    resolve(cwd, expandHomePath(target, context.homeDirectory)),
    syncDirectory,
    context.homeDirectory,
    {
      identityFile,
      kind: request.kind,
      localPathOverrides: request.localPathOverrides,
      profiles: effectiveProfiles,
      mode: request.mode,
      permission: request.permission,
      platformKey: context.platformKey,
      repoPath: request.repoPath,
    },
  );
  const existingEntry = config.entries.find(
    (entry) => entry.localPath === candidate.localPath,
  );
  const alreadyTracked =
    existingEntry !== undefined && existingEntry.kind === candidate.kind;

  if (existingEntry !== undefined && existingEntry.kind !== candidate.kind) {
    throw new DotweaveError(
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

  const nextEntry = (() => {
    if (existingEntry === undefined) {
      return candidate;
    }

    const configuredRepoPath =
      request.repoPath === undefined
        ? existingEntry.configuredRepoPath
        : mergePlatformStringValue(
            existingEntry.configuredRepoPath ?? {
              default: existingEntry.repoPath,
            },
            normalizePlatformRepoPath(request.repoPath),
          );
    const configuredMode = buildConfiguredMode(
      request.mode,
      existingEntry.configuredMode,
    );
    const configuredLocalPath =
      request.localPathOverrides === undefined
        ? existingEntry.configuredLocalPath
        : {
            ...existingEntry.configuredLocalPath,
            ...request.localPathOverrides,
            default: candidate.configuredLocalPath.default,
          };

    return {
      ...candidate,
      configuredLocalPath,
      configuredMode,
      ...(configuredRepoPath === undefined ? {} : { configuredRepoPath }),
      mode: resolvePlatformMode(configuredMode, context.platformKey),
      repoPath:
        configuredRepoPath === undefined
          ? existingEntry.repoPath
          : resolvePlatformValue(configuredRepoPath, context.platformKey),
    };
  })();

  const repoPathConflict = config.entries.find((entry) => {
    return (
      entry.repoPath === nextEntry.repoPath &&
      entry.localPath !== nextEntry.localPath
    );
  });

  if (repoPathConflict !== undefined) {
    throw new DotweaveError(
      "Sync target conflicts with an existing tracked entry.",
      {
        code: "TARGET_CONFLICT",
        details: [
          `Requested local path: ${nextEntry.localPath}`,
          `Requested repo path: ${nextEntry.repoPath}`,
          `Existing entry: ${repoPathConflict.localPath} -> ${repoPathConflict.repoPath}`,
        ],
        hint: "Change --repo or untrack the conflicting entry first.",
      },
    );
  }

  if (!alreadyTracked) {
    const nextConfig = buildSyncConfigDocument({
      ...config,
      entries: [...config.entries, nextEntry],
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig);

    return {
      alreadyTracked,
      changed: true,
      configuredLocalPath: nextEntry.configuredLocalPath,
      configuredMode: nextEntry.configuredMode,
      kind: nextEntry.kind,
      localPath: nextEntry.localPath,
      profiles: nextEntry.profiles,
      mode: nextEntry.mode,
      permission: nextEntry.permission,
      configuredPermission: nextEntry.configuredPermission,
      configuredRepoPath: nextEntry.configuredRepoPath,
      repoPath: nextEntry.repoPath,
    };
  }

  const modeChanged =
    request.mode !== undefined &&
    (existingEntry?.mode !== nextEntry.mode ||
      JSON.stringify(existingEntry?.configuredMode) !==
        JSON.stringify(nextEntry.configuredMode));
  const localPathChanged =
    request.localPathOverrides !== undefined &&
    JSON.stringify(existingEntry?.configuredLocalPath) !==
      JSON.stringify(nextEntry.configuredLocalPath);
  const profilesChanged =
    effectiveProfiles !== undefined &&
    (existingEntry?.profiles.length !== candidate.profiles.length ||
      !candidate.profiles.every((m) => existingEntry?.profiles.includes(m)));
  const repoPathChanged =
    request.repoPath !== undefined &&
    (existingEntry?.repoPath !== nextEntry.repoPath ||
      JSON.stringify(existingEntry?.configuredRepoPath) !==
        JSON.stringify(nextEntry.configuredRepoPath));
  const permissionChanged =
    request.permission !== undefined &&
    JSON.stringify(existingEntry?.configuredPermission) !==
      JSON.stringify(request.permission);
  const changed =
    localPathChanged ||
    modeChanged ||
    profilesChanged ||
    repoPathChanged ||
    permissionChanged;

  if (changed) {
    const nextConfig = buildSyncConfigDocument({
      ...config,
      entries: config.entries.map((entry) => {
        if (entry.localPath !== candidate.localPath) {
          return entry;
        }

        return {
          ...entry,
          ...(localPathChanged
            ? { configuredLocalPath: nextEntry.configuredLocalPath }
            : {}),
          ...(repoPathChanged
            ? {
                configuredRepoPath: nextEntry.configuredRepoPath,
                repoPath: nextEntry.repoPath,
              }
            : {}),
          ...(modeChanged
            ? {
                configuredMode: nextEntry.configuredMode,
                mode: nextEntry.mode,
              }
            : {}),
          ...(permissionChanged
            ? {
                configuredPermission: request.permission,
                permission: parsePermissionOctal(request.permission.default),
                permissionExplicit: true,
              }
            : {}),
          ...(profilesChanged
            ? {
                profiles: candidate.profiles,
                profilesExplicit: candidate.profilesExplicit,
              }
            : {}),
        };
      }),
    });

    await writeValidatedSyncConfig(syncDirectory, nextConfig);
  }

  return {
    alreadyTracked,
    changed,
    configuredLocalPath: localPathChanged
      ? nextEntry.configuredLocalPath
      : (existingEntry?.configuredLocalPath ?? nextEntry.configuredLocalPath),
    configuredMode: modeChanged
      ? nextEntry.configuredMode
      : (existingEntry?.configuredMode ?? nextEntry.configuredMode),
    kind: nextEntry.kind,
    localPath: nextEntry.localPath,
    profiles: profilesChanged
      ? nextEntry.profiles
      : (existingEntry?.profiles ?? []),
    mode: modeChanged
      ? nextEntry.mode
      : (existingEntry?.mode ?? nextEntry.mode),
    permission: permissionChanged
      ? parsePermissionOctal(request.permission.default)
      : existingEntry?.permission,
    configuredPermission: permissionChanged
      ? request.permission
      : existingEntry?.configuredPermission,
    configuredRepoPath:
      repoPathChanged || !alreadyTracked
        ? nextEntry.configuredRepoPath
        : existingEntry?.configuredRepoPath,
    repoPath:
      repoPathChanged || !alreadyTracked
        ? nextEntry.repoPath
        : (existingEntry?.repoPath ?? nextEntry.repoPath),
  };
};
