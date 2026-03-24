import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, sep } from "node:path";

import { z } from "zod";
import type { ConfiguredLocalPath } from "#app/config/platform.js";
import {
  getDefaultLocalPath,
  resolveLocalPathForPlatform,
} from "#app/config/platform.js";
import {
  resolveDevsyncSyncDirectory,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
  resolvePlatformConfiguredAbsolutePath,
} from "#app/config/xdg.js";
import { doPathsOverlap } from "#app/lib/path.js";
import { ensureTrailingNewline } from "#app/lib/string.js";
import { formatInputIssues } from "#app/lib/validation.js";
import { DevsyncError } from "#app/services/error.js";

export const syncConfigFileName = "manifest.json";
export const syncSecretArtifactSuffix = ".devsync.secret";

const syncEntryKinds = ["file", "directory"] as const;
export const syncModes = ["normal", "secret", "ignore"] as const;

const requiredTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, "Value must not be empty.");

const syncMachineNameArraySchema = z
  .array(requiredTrimmedStringSchema)
  .min(1, "At least one machine must be specified.");

const platformLocalPathSchema = z
  .object({
    default: requiredTrimmedStringSchema,
    win: requiredTrimmedStringSchema.optional(),
    mac: requiredTrimmedStringSchema.optional(),
    linux: requiredTrimmedStringSchema.optional(),
  })
  .strict();

const localPathSchema = platformLocalPathSchema;

const syncConfigEntrySchema = z
  .object({
    kind: z.enum(syncEntryKinds),
    localPath: localPathSchema,
    machines: syncMachineNameArraySchema.optional(),
    mode: z.enum(syncModes).optional(),
  })
  .strict();

const syncConfigAgeSchema = z
  .object({
    identityFile: requiredTrimmedStringSchema,
    recipients: z
      .array(requiredTrimmedStringSchema)
      .min(1, "At least one age recipient is required."),
  })
  .strict();

const syncConfigSchemaV5 = z
  .object({
    version: z.literal(5),
    entries: z.array(syncConfigEntrySchema),
  })
  .strict();

const syncConfigSchemaV6 = z
  .object({
    version: z.literal(6),
    age: syncConfigAgeSchema,
    entries: z.array(syncConfigEntrySchema),
  })
  .strict();

const syncConfigSchema = z.union([syncConfigSchemaV5, syncConfigSchemaV6]);

export type SyncConfigEntryKind = (typeof syncEntryKinds)[number];
export type SyncMode = (typeof syncModes)[number];
export type SyncConfig = z.infer<typeof syncConfigSchema>;

export type ResolvedSyncConfigEntry = Readonly<{
  configuredLocalPath: ConfiguredLocalPath;
  kind: SyncConfigEntryKind;
  localPath: string;
  machines: readonly string[];
  machinesExplicit: boolean;
  mode: SyncMode;
  modeExplicit: boolean;
  name: string;
  repoPath: string;
}>;

export type ResolvedSyncConfigAge = Readonly<{
  identityFile: string;
  recipients: readonly string[];
}>;

export type ResolvedSyncConfig = Readonly<{
  age?: ResolvedSyncConfigAge;
  entries: readonly ResolvedSyncConfigEntry[];
  version: 5 | 6;
}>;

export const syncDefaultMachine = "default";

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
      `Repository path must not use the reserved suffix ${syncSecretArtifactSuffix}.`,
      {
        code: "RESERVED_SECRET_SUFFIX",
        details: [`Repository path: ${value}`],
        hint: "Rename the path so no segment ends with the secret artifact suffix.",
      },
    );
  }

  return normalizedValue;
};

export const normalizeSyncMachineName = (
  value: string,
  description = "Machine name",
) => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new DevsyncError(`${description} must not be empty.`, {
      code: "INVALID_MACHINE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use a short machine name like 'work' or 'personal'.",
    });
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalizedValue)) {
    throw new DevsyncError(`${description} contains unsupported characters.`, {
      code: "INVALID_MACHINE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use letters, numbers, dots, underscores, or hyphens, and start with a letter or number.",
    });
  }

  if (normalizedValue.startsWith(".")) {
    throw new DevsyncError(`${description} must not start with '.'.`, {
      code: "INVALID_MACHINE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use a plain name like 'work' instead of hidden-path style names.",
    });
  }

  if (normalizedValue === "." || normalizedValue === "..") {
    throw new DevsyncError(`${description} is invalid.`, {
      code: "INVALID_MACHINE_NAME",
      details: [`${description}: ${value}`],
    });
  }

  return normalizedValue;
};

export const hasReservedSyncArtifactSuffixSegment = (value: string) => {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment.endsWith(syncSecretArtifactSuffix));
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
  config: Pick<ResolvedSyncConfig, "entries">,
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
  value: ConfiguredLocalPath,
  environment: NodeJS.ProcessEnv,
) => {
  const homeDirectory = resolveHomeDirectory(environment);
  const platformPath = resolveLocalPathForPlatform(value);
  let resolvedLocalPath: string;

  try {
    resolvedLocalPath = resolvePlatformConfiguredAbsolutePath(
      platformPath,
      environment,
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
  localPath: ConfiguredLocalPath,
  environment: NodeJS.ProcessEnv,
) => {
  const homeDirectory = resolveHomeDirectory(environment);
  const defaultPath = getDefaultLocalPath(localPath);
  const resolvedDefaultPath = resolveHomeConfiguredAbsolutePath(
    defaultPath,
    environment,
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
        throw new DevsyncError(
          `Duplicate ${description.toLowerCase()} paths in manifest.json.`,
          {
            code: "DUPLICATE_PATHS",
            details: [
              `${currentEntry.name}: ${currentValue}`,
              `${otherEntry.name}: ${otherValue}`,
            ],
            hint: "Remove the duplicate entry from manifest.json.",
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
          `${description} paths must not overlap in manifest.json.`,
          {
            code: "OVERLAPPING_PATHS",
            details: [
              `${currentEntry.name}: ${currentValue}`,
              `${otherEntry.name}: ${otherValue}`,
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

const buildNormalizedMachines = (
  entry: z.infer<typeof syncConfigEntrySchema>,
): readonly string[] => {
  if (entry.machines === undefined || entry.machines.length === 0) {
    return [];
  }

  for (const machine of entry.machines) {
    normalizeSyncMachineName(machine);
  }

  return entry.machines;
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
): ResolvedSyncConfigEntry[] => {
  const sorted = [...entries].sort(
    (a, b) => a.repoPath.length - b.repoPath.length,
  );

  const resolved = new Map<string, ResolvedSyncConfigEntry>();

  for (const entry of sorted) {
    const parent = findNearestParentEntry(resolved, entry.repoPath);

    const inheritedMode =
      !entry.modeExplicit && parent !== undefined ? parent.mode : entry.mode;

    const inheritedMachines =
      !entry.machinesExplicit && parent !== undefined
        ? parent.machines
        : entry.machines;

    resolved.set(entry.repoPath, {
      ...entry,
      machines: inheritedMachines,
      mode: inheritedMode,
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
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedSyncConfig => {
  const result = syncConfigSchema.safeParse(input);

  if (!result.success) {
    throw new DevsyncError("Sync configuration is invalid.", {
      code: "CONFIG_VALIDATION_FAILED",
      details: formatInputIssues(result.error.issues).split("\n"),
      hint: "Fix the invalid fields in manifest.json, then run the command again.",
    });
  }

  const rawEntries = result.data.entries.map((entry) => {
    const resolvedLocalPath = resolveSyncEntryLocalPath(
      entry.localPath,
      environment,
    );
    const repoPath = deriveRepoPathFromLocalPath(entry.localPath, environment);
    const machines = buildNormalizedMachines(entry);
    const mode = entry.mode ?? "normal";

    return {
      configuredLocalPath: entry.localPath,
      kind: entry.kind,
      localPath: resolvedLocalPath,
      machines,
      machinesExplicit: entry.machines !== undefined,
      mode,
      modeExplicit: entry.mode !== undefined,
      name: repoPath,
      repoPath,
    } satisfies ResolvedSyncConfigEntry;
  });

  validateResolvedSyncConfigEntries(rawEntries);

  const entries = applyEntryInheritance(rawEntries);

  const age =
    result.data.version === 6
      ? {
          identityFile: result.data.age.identityFile,
          recipients: [...new Set(result.data.age.recipients)],
        }
      : undefined;

  return {
    ...(age === undefined ? {} : { age }),
    entries,
    version: result.data.version,
  };
};

export const createInitialSyncConfig = (age: {
  identityFile: string;
  recipients: string[];
}): SyncConfig => {
  return {
    version: 6,
    age,
    entries: [],
  };
};

export const formatSyncConfig = (config: SyncConfig) => {
  return ensureTrailingNewline(JSON.stringify(config, null, 2));
};

export const resolveSyncConfigPath = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return posix.join(
    resolveDevsyncSyncDirectory(environment).replaceAll("\\", "/"),
    syncConfigFileName,
  );
};

export const resolveSyncConfigFilePath = (
  syncDirectory: string = resolveDevsyncSyncDirectory(),
) => {
  return join(syncDirectory, syncConfigFileName);
};

export const resolveSyncArtifactsDirectoryPath = (syncDirectory: string) => {
  return syncDirectory;
};

export const readSyncConfig = async (
  syncDirectory: string = resolveDevsyncSyncDirectory(),
  environment: NodeJS.ProcessEnv = process.env,
) => {
  try {
    const contents = await readFile(
      resolveSyncConfigFilePath(syncDirectory),
      "utf8",
    );

    return parseSyncConfig(JSON.parse(contents) as unknown, environment);
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
        hint: "Fix the JSON syntax in manifest.json, then run the command again.",
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

const resolveMachineForEntry = (
  entry: Pick<ResolvedSyncConfigEntry, "machines">,
  activeMachine: string | undefined,
): string | undefined => {
  if (entry.machines.length === 0) {
    return syncDefaultMachine;
  }

  const effective =
    activeMachine !== undefined && activeMachine !== syncDefaultMachine
      ? activeMachine
      : syncDefaultMachine;

  return entry.machines.includes(effective) ? effective : undefined;
};

export const resolveSyncRule = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeMachine?: string,
): { mode: SyncMode; machine: string } | undefined => {
  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined) {
    return undefined;
  }

  const machine = resolveMachineForEntry(entry, activeMachine);

  if (machine === undefined) {
    return undefined;
  }

  return { mode: entry.mode, machine };
};

export const resolveSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeMachine?: string,
): SyncMode | undefined => {
  return resolveSyncRule(config, repoPath, activeMachine)?.mode;
};

export const isIgnoredSyncPath = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  return resolveSyncMode(config, repoPath) === "ignore";
};

export const isSecretSyncPath = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  return resolveSyncMode(config, repoPath) === "secret";
};

export const resolveManagedSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeMachine?: string,
  context?: string,
) => {
  const mode = resolveSyncMode(config, repoPath, activeMachine);

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

export const collectAllMachineNames = (
  entries: readonly ResolvedSyncConfigEntry[],
): string[] => {
  const machines = new Set<string>();

  for (const entry of entries) {
    for (const machine of entry.machines) {
      machines.add(machine);
    }
  }

  return [...machines].sort((left, right) => left.localeCompare(right));
};
