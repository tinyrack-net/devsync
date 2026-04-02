import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep } from "node:path";

import { z } from "zod";
import { CONSTANTS } from "#app/config/constants.ts";
import {
  type PlatformKey,
  type PlatformStringValue,
  resolvePlatformValue,
} from "#app/config/platform.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { parsePermissionOctal } from "#app/lib/file-mode.ts";
import { doPathsOverlap } from "#app/lib/path.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import { formatInputIssues } from "#app/lib/validation.ts";

const syncEntryKinds = ["file", "directory"] as const;

const requiredTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, "Value must not be empty.");

const syncProfileNameArraySchema = z
  .array(requiredTrimmedStringSchema)
  .min(1, "At least one profile must be specified.");

const platformLocalPathSchema = z
  .object({
    default: requiredTrimmedStringSchema,
    win: requiredTrimmedStringSchema.optional(),
    mac: requiredTrimmedStringSchema.optional(),
    linux: requiredTrimmedStringSchema.optional(),
    wsl: requiredTrimmedStringSchema.optional(),
  })
  .strict();

const localPathSchema = platformLocalPathSchema;
const platformRepoPathSchema = z
  .object({
    default: requiredTrimmedStringSchema,
    win: requiredTrimmedStringSchema.optional(),
    mac: requiredTrimmedStringSchema.optional(),
    linux: requiredTrimmedStringSchema.optional(),
    wsl: requiredTrimmedStringSchema.optional(),
  })
  .strict();
const repoPathSchema = platformRepoPathSchema;
const platformSyncModeSchema = z
  .object({
    default: z.enum(CONSTANTS.SYNC.MODES),
    win: z.enum(CONSTANTS.SYNC.MODES).optional(),
    mac: z.enum(CONSTANTS.SYNC.MODES).optional(),
    linux: z.enum(CONSTANTS.SYNC.MODES).optional(),
    wsl: z.enum(CONSTANTS.SYNC.MODES).optional(),
  })
  .strict();

const permissionOctalSchema = z
  .string()
  .regex(
    /^0[0-7]{3}$/,
    "Permission must be a 4-character octal string like '0600' or '0755'.",
  );

const platformPermissionSchema = z
  .object({
    default: permissionOctalSchema,
    win: permissionOctalSchema.optional(),
    mac: permissionOctalSchema.optional(),
    linux: permissionOctalSchema.optional(),
    wsl: permissionOctalSchema.optional(),
  })
  .strict();

const syncConfigEntrySchema = z
  .object({
    kind: z.enum(syncEntryKinds),
    localPath: localPathSchema,
    repoPath: repoPathSchema.optional(),
    profiles: syncProfileNameArraySchema.optional(),
    mode: platformSyncModeSchema.optional(),
    permission: platformPermissionSchema.optional(),
  })
  .strict();

const syncConfigAgeSchema = z
  .object({
    recipients: z
      .array(requiredTrimmedStringSchema)
      .min(1, "At least one age recipient is required."),
  })
  .strict();

const syncConfigSchemaV7 = z
  .object({
    version: z.literal(CONSTANTS.SYNC.CONFIG_VERSION),
    age: syncConfigAgeSchema.optional(),
    entries: z.array(syncConfigEntrySchema),
  })
  .strict();

const syncConfigSchema = syncConfigSchemaV7;

export const syncConfigFileName = CONSTANTS.SYNC.CONFIG_FILE_NAME;

export type SyncConfigEntryKind = (typeof syncEntryKinds)[number];
export type SyncMode = (typeof CONSTANTS.SYNC.MODES)[number];
export type ConfiguredSyncRepoPath = PlatformStringValue;
export type PlatformSyncMode = z.infer<typeof platformSyncModeSchema>;
export type PlatformPermission = z.infer<typeof platformPermissionSchema>;
export type SyncConfig = z.infer<typeof syncConfigSchema>;

export type SyncConfigResolutionContext = Readonly<{
  homeDirectory: string;
  platformKey: PlatformKey;
  readEnv: (name: string) => string | undefined;
  xdgConfigHome: string;
}>;

export type ResolvedSyncConfigEntry = Readonly<{
  configuredMode: PlatformSyncMode;
  configuredLocalPath: PlatformStringValue;
  configuredPermission?: PlatformPermission;
  configuredRepoPath?: ConfiguredSyncRepoPath;
  kind: SyncConfigEntryKind;
  localPath: string;
  profiles: readonly string[];
  profilesExplicit: boolean;
  mode: SyncMode;
  modeExplicit: boolean;
  permission?: number;
  permissionExplicit: boolean;
  repoPath: string;
}>;

export type AgeConfig = Readonly<{
  recipients: readonly string[];
}>;

export type ResolvedManifest = Readonly<{
  age?: AgeConfig;
  entries: readonly ResolvedSyncConfigEntry[];
  version: typeof CONSTANTS.SYNC.CONFIG_VERSION;
}>;

const defaultSyncMode: PlatformSyncMode = { default: CONSTANTS.SYNC.MODES[0] };

const resolveSyncModeForPlatform = (
  configuredMode: PlatformSyncMode,
  platformKey: PlatformKey,
): SyncMode => {
  if (platformKey === "wsl") {
    return configuredMode.wsl ?? configuredMode.linux ?? configuredMode.default;
  }

  return configuredMode[platformKey] ?? configuredMode.default;
};

const resolveSyncPermissionForPlatform = (
  configuredPermission: PlatformPermission,
  platformKey: PlatformKey,
): number => {
  if (platformKey === "wsl") {
    const raw =
      configuredPermission.wsl ??
      configuredPermission.linux ??
      configuredPermission.default;
    return parsePermissionOctal(raw);
  }

  const raw = configuredPermission[platformKey] ?? configuredPermission.default;
  return parsePermissionOctal(raw);
};

const normalizeConfiguredRepoPath = (
  repoPath: ConfiguredSyncRepoPath,
): ConfiguredSyncRepoPath => {
  const result: Record<string, string> = {
    default: normalizeSyncRepoPath(repoPath.default),
  };

  for (const key of ["win", "mac", "linux", "wsl"] as const) {
    if (repoPath[key] !== undefined) {
      result[key] = normalizeSyncRepoPath(repoPath[key]);
    }
  }

  return result as ConfiguredSyncRepoPath;
};

export const normalizeSyncRepoPath = (value: string) => {
  const normalizedValue = posix.normalize(value.replaceAll("\\", "/"));

  if (
    normalizedValue === "" ||
    normalizedValue === "." ||
    normalizedValue.startsWith("../") ||
    normalizedValue.includes("/../") ||
    normalizedValue.startsWith("/")
  ) {
    throw new DevsyncError(
      "Repository path must be a relative POSIX path inside the repository root.",
      {
        code: "INVALID_REPO_PATH",
        details: [`Repository path: ${value}`],
        hint: "Use a relative path like '.config/tool/settings.json' without '..' segments.",
      },
    );
  }

  if (hasReservedSyncArtifactSuffixSegment(normalizedValue)) {
    throw new DevsyncError(
      `Repository path must not use the reserved suffix ${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}.`,
      {
        code: "RESERVED_SECRET_SUFFIX",
        details: [`Repository path: ${value}`],
        hint: "Rename the path so no segment ends with the secret artifact suffix.",
      },
    );
  }

  return normalizedValue;
};

export const normalizeSyncProfileName = (
  value: string,
  description = "Profile name",
) => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new DevsyncError(`${description} must not be empty.`, {
      code: "INVALID_PROFILE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use a short profile name like 'work' or 'personal'.",
    });
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalizedValue)) {
    throw new DevsyncError(`${description} contains unsupported characters.`, {
      code: "INVALID_PROFILE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use letters, numbers, dots, underscores, or hyphens, and start with a letter or number.",
    });
  }

  if (normalizedValue.startsWith(".")) {
    throw new DevsyncError(`${description} must not start with '.'.`, {
      code: "INVALID_PROFILE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use a plain name like 'work' instead of hidden-path style names.",
    });
  }

  if (normalizedValue === "." || normalizedValue === "..") {
    throw new DevsyncError(`${description} is invalid.`, {
      code: "INVALID_PROFILE_NAME",
      details: [`${description}: ${value}`],
    });
  }

  return normalizedValue;
};

export const hasReservedSyncArtifactSuffixSegment = (value: string) => {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment.endsWith(CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX));
};

const matchesEntryPath = (
  entry: Pick<ResolvedSyncConfigEntry, "kind" | "repoPath">,
  repoPath: string,
) => {
  return (
    entry.repoPath === repoPath ||
    (entry.kind === "directory" && repoPath.startsWith(`${entry.repoPath}/`))
  );
};

export const findOwningSyncEntry = (
  config: Pick<ResolvedManifest, "entries">,
  repoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  let best: ResolvedSyncConfigEntry | undefined;

  for (const entry of config.entries) {
    if (
      matchesEntryPath(entry, repoPath) &&
      (best === undefined || entry.repoPath.length > best.repoPath.length)
    ) {
      best = entry;
    }
  }

  return best;
};

export const collectChildEntryPaths = (
  config: Pick<ResolvedManifest, "entries">,
  repoPath: string,
): ReadonlySet<string> => {
  return new Set(
    config.entries.flatMap((entry) => {
      return entry.repoPath !== repoPath &&
        entry.repoPath.startsWith(`${repoPath}/`)
        ? [entry.repoPath]
        : [];
    }),
  );
};

export const resolveEntryRelativeRepoPath = (
  entry: Pick<ResolvedSyncConfigEntry, "kind" | "repoPath">,
  repoPath: string,
) => {
  if (entry.kind === "file") {
    return repoPath === entry.repoPath ? "" : undefined;
  }

  if (repoPath === entry.repoPath) {
    return "";
  }

  if (!repoPath.startsWith(`${entry.repoPath}/`)) {
    return undefined;
  }

  return repoPath.slice(entry.repoPath.length + 1);
};

const resolveSyncEntryLocalPath = (
  value: PlatformStringValue,
  context: SyncConfigResolutionContext,
) => {
  const { platformKey, homeDirectory, xdgConfigHome, readEnv } = context;
  const platformPath = resolvePlatformValue(value, platformKey);
  let resolvedLocalPath: string;

  try {
    resolvedLocalPath = resolveConfiguredAbsolutePath(
      platformPath,
      homeDirectory,
      xdgConfigHome,
      readEnv,
    );
  } catch (error: unknown) {
    throw new DevsyncError(
      error instanceof Error
        ? error.message
        : `Invalid sync entry local path: ${platformPath}`,
    );
  }

  const relativePath = relative(homeDirectory, resolvedLocalPath);

  if (relativePath === "") {
    throw new DevsyncError(
      "Sync entry local path cannot be the home directory itself.",
      {
        code: "ENTRY_ROOT_DISALLOWED",
        details: [
          `Configured path: ${platformPath}`,
          `Home directory: ${homeDirectory}`,
        ],
        hint: "Track a file or subdirectory inside HOME instead.",
      },
    );
  }

  if (
    isAbsolute(relativePath) ||
    relativePath.startsWith("..") ||
    relativePath === ".."
  ) {
    throw new DevsyncError("Sync entry local path must stay inside HOME.", {
      code: "ENTRY_OUTSIDE_HOME",
      details: [
        `Configured path: ${platformPath}`,
        `Home directory: ${homeDirectory}`,
      ],
      hint: "Use a path under HOME, such as '~/...'.",
    });
  }

  return resolvedLocalPath;
};

export const deriveRepoPathFromLocalPath = (
  localPath: PlatformStringValue,
  homeDirectory: string,
) => {
  const resolvedDefaultPath = resolveConfiguredAbsolutePath(
    localPath.default,
    homeDirectory,
    undefined,
  );
  const relativePath = relative(homeDirectory, resolvedDefaultPath);

  return normalizeSyncRepoPath(relativePath.replaceAll("\\", "/"));
};

const validatePathOverlaps = (
  entries: readonly ResolvedSyncConfigEntry[],
  property: "localPath" | "repoPath",
  description: string,
) => {
  for (let index = 0; index < entries.length; index += 1) {
    const currentEntry = entries[index];

    if (currentEntry === undefined) {
      continue;
    }

    for (
      let otherIndex = index + 1;
      otherIndex < entries.length;
      otherIndex += 1
    ) {
      const otherEntry = entries[otherIndex];

      if (otherEntry === undefined) {
        continue;
      }

      const currentValue = currentEntry[property];
      const otherValue = otherEntry[property];

      if (currentValue === otherValue) {
        const isRepoPath = property === "repoPath";

        throw new DevsyncError(
          isRepoPath
            ? `Multiple entries target the same repository path in ${CONSTANTS.SYNC.CONFIG_FILE_NAME}.`
            : `Duplicate ${description.toLowerCase()} paths in ${CONSTANTS.SYNC.CONFIG_FILE_NAME}.`,
          {
            code: "DUPLICATE_PATHS",
            details: isRepoPath
              ? [
                  `${currentEntry.localPath} -> ${currentValue}`,
                  `${otherEntry.localPath} -> ${otherValue}`,
                ]
              : [
                  `${currentEntry.repoPath}: ${currentValue}`,
                  `${otherEntry.repoPath}: ${otherValue}`,
                ],
            hint: isRepoPath
              ? "Each entry must use a unique repoPath. Change or remove one of the conflicting entries."
              : `Remove the duplicate entry from ${CONSTANTS.SYNC.CONFIG_FILE_NAME}.`,
          },
        );
      }

      const isParentChild =
        currentValue.startsWith(`${otherValue}/`) ||
        currentValue.startsWith(`${otherValue}${sep}`) ||
        otherValue.startsWith(`${currentValue}/`) ||
        otherValue.startsWith(`${currentValue}${sep}`);

      if (isParentChild) {
        continue;
      }

      const overlaps =
        property === "repoPath"
          ? false
          : doPathsOverlap(currentValue, otherValue);

      if (overlaps) {
        throw new DevsyncError(
          `${description} paths must not overlap in ${CONSTANTS.SYNC.CONFIG_FILE_NAME}.`,
          {
            code: "OVERLAPPING_PATHS",
            details: [
              `${currentEntry.repoPath}: ${currentValue}`,
              `${otherEntry.repoPath}: ${otherValue}`,
            ],
            hint: "Split overlapping entries so each tracked root owns a distinct path.",
          },
        );
      }
    }
  }
};

export const validateResolvedSyncConfigEntries = (
  entries: readonly ResolvedSyncConfigEntry[],
) => {
  validatePathOverlaps(entries, "repoPath", "Repository");
  validatePathOverlaps(entries, "localPath", "Local");
};

const findNearestParentEntry = (
  entries: ReadonlyMap<string, ResolvedSyncConfigEntry>,
  childRepoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  let best: ResolvedSyncConfigEntry | undefined;

  for (const entry of entries.values()) {
    if (
      entry.kind === "directory" &&
      childRepoPath !== entry.repoPath &&
      childRepoPath.startsWith(`${entry.repoPath}/`) &&
      (best === undefined || entry.repoPath.length > best.repoPath.length)
    ) {
      best = entry;
    }
  }

  return best;
};

const applyEntryInheritance = (
  entries: ResolvedSyncConfigEntry[],
  platformKey: PlatformKey,
): ResolvedSyncConfigEntry[] => {
  const sorted = [...entries].sort(
    (a, b) => a.repoPath.length - b.repoPath.length,
  );

  const resolved = new Map<string, ResolvedSyncConfigEntry>();

  for (const entry of sorted) {
    const parent = findNearestParentEntry(resolved, entry.repoPath);

    const inheritedMode =
      !entry.modeExplicit && parent !== undefined
        ? parent.configuredMode
        : entry.configuredMode;

    const inheritedProfiles =
      !entry.profilesExplicit && parent !== undefined
        ? parent.profiles
        : entry.profiles;

    const inheritedPermission =
      !entry.permissionExplicit && parent !== undefined
        ? parent.configuredPermission
        : entry.configuredPermission;

    resolved.set(entry.repoPath, {
      ...entry,
      configuredMode: inheritedMode,
      configuredPermission: inheritedPermission,
      profiles: inheritedProfiles,
      mode: resolveSyncModeForPlatform(inheritedMode, platformKey),
      permission:
        inheritedPermission !== undefined
          ? resolveSyncPermissionForPlatform(inheritedPermission, platformKey)
          : undefined,
    });
  }

  return entries.map((e) => {
    const entry = resolved.get(e.repoPath);

    if (entry === undefined) {
      throw new Error(`Missing resolved entry for ${e.repoPath}`);
    }

    return entry;
  });
};

export const parseSyncConfig = (
  input: unknown,
  context: SyncConfigResolutionContext,
): ResolvedManifest => {
  const { platformKey, homeDirectory } = context;
  const result = syncConfigSchema.safeParse(input);

  if (!result.success) {
    throw new DevsyncError("Sync configuration is invalid.", {
      code: "CONFIG_VALIDATION_FAILED",
      details: formatInputIssues(result.error.issues).split("\n"),
      hint: `Fix the invalid fields in ${CONSTANTS.SYNC.CONFIG_FILE_NAME}, then run the command again.`,
    });
  }

  const rawEntries = result.data.entries.map((entry) => {
    const resolvedLocalPath = resolveSyncEntryLocalPath(
      entry.localPath,
      context,
    );
    const configuredRepoPath =
      entry.repoPath === undefined
        ? undefined
        : normalizeConfiguredRepoPath(entry.repoPath);
    const repoPath =
      configuredRepoPath === undefined
        ? deriveRepoPathFromLocalPath(entry.localPath, homeDirectory)
        : resolvePlatformValue(configuredRepoPath, platformKey);

    if (entry.profiles !== undefined && entry.profiles.length > 0) {
      for (const profile of entry.profiles) {
        normalizeSyncProfileName(profile);
      }
    }
    const profiles =
      entry.profiles !== undefined && entry.profiles.length > 0
        ? entry.profiles
        : [];

    const configuredMode = entry.mode ?? defaultSyncMode;
    const configuredPermission = entry.permission;

    return {
      configuredMode,
      configuredLocalPath: entry.localPath,
      configuredPermission,
      ...(configuredRepoPath === undefined ? {} : { configuredRepoPath }),
      kind: entry.kind,
      localPath: resolvedLocalPath,
      profiles,
      profilesExplicit: entry.profiles !== undefined,
      mode: resolveSyncModeForPlatform(configuredMode, platformKey),
      modeExplicit: entry.mode !== undefined,
      permission:
        configuredPermission !== undefined
          ? resolveSyncPermissionForPlatform(configuredPermission, platformKey)
          : undefined,
      permissionExplicit: entry.permission !== undefined,
      repoPath,
    } satisfies ResolvedSyncConfigEntry;
  });

  validateResolvedSyncConfigEntries(rawEntries);

  const entries = applyEntryInheritance(rawEntries, platformKey);

  const age =
    result.data.age === undefined
      ? undefined
      : {
          recipients: [...new Set(result.data.age.recipients)],
        };

  return {
    ...(age === undefined ? {} : { age }),
    entries,
    version: result.data.version,
  };
};

export const createInitialSyncConfig = (age: {
  recipients: string[];
}): SyncConfig => {
  return {
    version: CONSTANTS.SYNC.CONFIG_VERSION,
    age,
    entries: [],
  };
};

export const formatSyncConfig = (config: SyncConfig) => {
  return ensureTrailingNewline(JSON.stringify(config, null, 2));
};

export const resolveSyncConfigFilePath = (syncDirectory: string) => {
  return join(syncDirectory, CONSTANTS.SYNC.CONFIG_FILE_NAME);
};

export const readSyncConfig = async (
  syncDirectory: string,
  context: SyncConfigResolutionContext,
) => {
  try {
    const contents = await readFile(
      resolveSyncConfigFilePath(syncDirectory),
      "utf8",
    );

    return parseSyncConfig(JSON.parse(contents) as unknown, context);
  } catch (error: unknown) {
    if (error instanceof DevsyncError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new DevsyncError("Sync configuration is not valid JSON.", {
        code: "CONFIG_INVALID_JSON",
        details: [
          `Config file: ${resolveSyncConfigFilePath(syncDirectory)}`,
          error.message,
        ],
        hint: `Fix the JSON syntax in ${CONSTANTS.SYNC.CONFIG_FILE_NAME}, then run the command again.`,
      });
    }

    throw new DevsyncError("Failed to read sync configuration.", {
      code: "CONFIG_READ_FAILED",
      details: [
        `Config file: ${resolveSyncConfigFilePath(syncDirectory)}`,
        ...(error instanceof Error ? [error.message] : []),
      ],
      hint: "Run 'devsync init' if the sync repository has not been initialized yet.",
    });
  }
};

const resolveProfileForEntry = (
  entry: Pick<ResolvedSyncConfigEntry, "profiles">,
  activeProfile: string | undefined,
): string | undefined => {
  if (entry.profiles.length === 0) {
    return CONSTANTS.SYNC.DEFAULT_PROFILE;
  }

  const effective =
    activeProfile !== undefined &&
    activeProfile !== CONSTANTS.SYNC.DEFAULT_PROFILE
      ? activeProfile
      : CONSTANTS.SYNC.DEFAULT_PROFILE;

  return entry.profiles.includes(effective) ? effective : undefined;
};

export const resolveSyncRule = (
  config: ResolvedManifest,
  repoPath: string,
  activeProfile?: string,
): { mode: SyncMode; profile: string } | undefined => {
  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined) {
    return undefined;
  }

  const profile = resolveProfileForEntry(entry, activeProfile);

  if (profile === undefined) {
    return undefined;
  }

  return { mode: entry.mode, profile };
};

export const resolveSyncMode = (
  config: ResolvedManifest,
  repoPath: string,
  activeProfile?: string,
): SyncMode | undefined => {
  return resolveSyncRule(config, repoPath, activeProfile)?.mode;
};

export const isIgnoredSyncPath = (
  config: ResolvedManifest,
  repoPath: string,
) => {
  return resolveSyncMode(config, repoPath) === "ignore";
};

export const isSecretSyncPath = (
  config: ResolvedManifest,
  repoPath: string,
) => {
  return resolveSyncMode(config, repoPath) === "secret";
};

export const resolveManagedSyncMode = (
  config: ResolvedManifest,
  repoPath: string,
  activeProfile?: string,
  context?: string,
) => {
  const mode = resolveSyncMode(config, repoPath, activeProfile);

  if (mode === undefined) {
    throw new DevsyncError(
      "Repository path is not managed by the current sync configuration.",
      {
        code: "UNMANAGED_SYNC_PATH",
        details: [
          `Repository path: ${repoPath}`,
          ...(context === undefined ? [] : [`Context: ${context}`]),
        ],
        hint: "Add the parent path to devsync, or remove stray artifacts from the sync repository.",
      },
    );
  }

  return mode;
};

export const collectAllProfileNames = (
  entries: readonly ResolvedSyncConfigEntry[],
): string[] => {
  const profiles = new Set<string>();

  for (const entry of entries) {
    for (const profile of entry.profiles) {
      profiles.add(profile);
    }
  }

  return [...profiles].sort((left, right) => left.localeCompare(right));
};
