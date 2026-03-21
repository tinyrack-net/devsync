import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative } from "node:path";

import { z } from "zod";
import {
  resolveConfiguredAbsolutePath,
  resolveDevsyncSyncDirectory,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import { formatInputIssues } from "#app/lib/validation.ts";
import { DevsyncError } from "#app/services/error.ts";
import { doPathsOverlap } from "#app/services/paths.ts";

export const syncConfigFileName = "config.json";
export const syncSecretArtifactSuffix = ".devsync.secret";

const syncEntryKinds = ["file", "directory"] as const;
export const syncModes = ["normal", "secret", "ignore"] as const;

const requiredTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, "Value must not be empty.");

const syncOverrideMapSchema = z.record(
  requiredTrimmedStringSchema,
  z.enum(syncModes),
);

const syncMachineNameArraySchema = z
  .array(requiredTrimmedStringSchema)
  .min(1, "At least one machine must be specified.");

const syncConfigFileEntrySchema = z
  .object({
    kind: z.literal("file"),
    localPath: requiredTrimmedStringSchema,
    machines: syncMachineNameArraySchema.optional(),
    mode: z.enum(syncModes).optional(),
  })
  .strict();

const syncConfigDirectoryEntrySchema = z
  .object({
    kind: z.literal("directory"),
    localPath: requiredTrimmedStringSchema,
    machines: z
      .record(requiredTrimmedStringSchema, syncMachineNameArraySchema)
      .optional(),
    mode: z.enum(syncModes).optional(),
    rules: syncOverrideMapSchema.optional(),
  })
  .strict();

const syncConfigEntrySchema = z.discriminatedUnion("kind", [
  syncConfigFileEntrySchema,
  syncConfigDirectoryEntrySchema,
]);

const syncConfigSchema = z
  .object({
    version: z.literal(3),
    age: z
      .object({
        recipients: z
          .array(requiredTrimmedStringSchema)
          .min(1, "At least one age recipient is required."),
        identityFile: requiredTrimmedStringSchema,
      })
      .strict(),
    entries: z.array(syncConfigEntrySchema),
  })
  .strict();

export type SyncConfigEntryKind = (typeof syncEntryKinds)[number];
export type SyncMode = (typeof syncModes)[number];
export type SyncConfig = z.infer<typeof syncConfigSchema>;
export type SyncOverrideMatch = "exact" | "subtree";

export type ResolvedSyncOverride = Readonly<{
  match: SyncOverrideMatch;
  mode: SyncMode;
  path: string;
}>;

export type ResolvedSyncConfigEntry = Readonly<{
  configuredLocalPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  machines: Readonly<Record<string, readonly string[]>>;
  mode: SyncMode;
  modeExplicit: boolean;
  name: string;
  overrides: readonly ResolvedSyncOverride[];
  repoPath: string;
}>;

export type ResolvedSyncConfig = Readonly<{
  age: Readonly<{
    configuredIdentityFile: string;
    identityFile: string;
    recipients: readonly string[];
  }>;
  entries: readonly ResolvedSyncConfigEntry[];
  version: 3;
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

export const normalizeSyncOverridePath = (
  value: string,
  description = "Override path",
) => {
  const posixValue = value.replaceAll("\\", "/");

  if (
    posixValue === "" ||
    posixValue === "." ||
    posixValue === ".." ||
    posixValue.startsWith("../") ||
    posixValue.includes("/../") ||
    posixValue.startsWith("/")
  ) {
    throw new DevsyncError(
      `${description} must be a relative POSIX path inside the repository root.`,
      {
        code: "INVALID_OVERRIDE_PATH",
        details: [`${description}: ${value}`],
        hint: "Use a relative child path without '..' segments.",
      },
    );
  }

  const normalizedValue = posix.normalize(posixValue);

  if (
    normalizedValue === "" ||
    normalizedValue === "." ||
    normalizedValue === ".." ||
    normalizedValue.startsWith("../") ||
    normalizedValue.includes("/../") ||
    normalizedValue.startsWith("/")
  ) {
    throw new DevsyncError(
      `${description} must be a relative POSIX path inside the repository root.`,
      {
        code: "INVALID_OVERRIDE_PATH",
        details: [`${description}: ${value}`],
        hint: "Use a relative child path without '..' segments.",
      },
    );
  }

  if (hasReservedSyncArtifactSuffixSegment(normalizedValue)) {
    throw new DevsyncError(
      `${description} must not use the reserved suffix ${syncSecretArtifactSuffix}.`,
      {
        code: "RESERVED_SECRET_SUFFIX",
        details: [`${description}: ${value}`],
        hint: "Rename the path so no segment ends with the secret artifact suffix.",
      },
    );
  }

  return normalizedValue;
};

export const hasReservedSyncArtifactSuffixSegment = (value: string) => {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment.endsWith(syncSecretArtifactSuffix));
};

export const normalizeSyncOverrideSelector = (
  value: string,
  description = "Override selector",
): ResolvedSyncOverride => {
  const posixValue = value.replaceAll("\\", "/");
  const match = posixValue.endsWith("/") ? "subtree" : "exact";
  const trimmedValue =
    match === "subtree" ? posixValue.replace(/\/+$/u, "") : posixValue;

  return {
    match,
    mode: "normal",
    path: normalizeSyncOverridePath(trimmedValue, description),
  };
};

export const formatSyncOverrideSelector = (
  override: Pick<ResolvedSyncOverride, "match" | "path">,
) => {
  return override.match === "subtree" ? `${override.path}/` : override.path;
};

const buildResolvedOverrides = (
  overrides: Record<string, SyncMode> | undefined,
  description: string,
) => {
  return Object.entries(overrides ?? {}).map(([selector, mode]) => {
    return {
      ...normalizeSyncOverrideSelector(selector, description),
      mode,
    } satisfies ResolvedSyncOverride;
  });
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
  return config.entries.find((entry) => matchesEntryPath(entry, repoPath));
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

const getRulePathDepth = (path: string) => {
  return path.split("/").length;
};

const compareOverrideSpecificity = (
  left: Pick<ResolvedSyncOverride, "match" | "path">,
  right: Pick<ResolvedSyncOverride, "match" | "path">,
) => {
  const depthComparison =
    getRulePathDepth(right.path) - getRulePathDepth(left.path);

  if (depthComparison !== 0) {
    return depthComparison;
  }

  if (left.match === right.match) {
    return 0;
  }

  return left.match === "exact" ? -1 : 1;
};

const matchesOverride = (
  override: Pick<ResolvedSyncOverride, "match" | "path">,
  relativePath: string,
) => {
  if (relativePath === "") {
    return false;
  }

  if (override.match === "exact") {
    return override.path === relativePath;
  }

  return (
    override.path === relativePath ||
    relativePath.startsWith(`${override.path}/`)
  );
};

export const resolveRelativeSyncMode = (
  mode: SyncMode,
  overrides: readonly Pick<ResolvedSyncOverride, "match" | "mode" | "path">[],
  relativePath: string,
) => {
  if (relativePath === "") {
    return mode;
  }

  const matchingOverride = [...overrides]
    .filter((override) => {
      return matchesOverride(override, relativePath);
    })
    .sort(compareOverrideSpecificity)[0];

  return matchingOverride?.mode ?? mode;
};

export const resolveFileMachine = (
  machines: Readonly<Record<string, readonly string[]>>,
  relativePath: string,
  activeMachine: string | undefined,
): string => {
  const machineList = machines[relativePath];

  if (machineList === undefined || machineList.length === 0) {
    return syncDefaultMachine;
  }

  if (
    activeMachine !== undefined &&
    activeMachine !== syncDefaultMachine &&
    machineList.includes(activeMachine)
  ) {
    return activeMachine;
  }

  return syncDefaultMachine;
};

export const resolveRelativeSyncRule = (
  entry: Pick<ResolvedSyncConfigEntry, "machines" | "mode" | "overrides">,
  relativePath: string,
  activeMachine: string | undefined,
): { mode: SyncMode; machine: string } => {
  const mode = resolveRelativeSyncMode(
    entry.mode,
    entry.overrides,
    relativePath,
  );
  const machine = resolveFileMachine(
    entry.machines,
    relativePath,
    activeMachine,
  );

  return { mode, machine };
};

const resolveSyncEntryLocalPath = (
  value: string,
  environment: NodeJS.ProcessEnv,
) => {
  const homeDirectory = resolveHomeDirectory(environment);
  let resolvedLocalPath: string;

  try {
    resolvedLocalPath = resolveHomeConfiguredAbsolutePath(value, environment);
  } catch (error: unknown) {
    throw new DevsyncError(
      error instanceof Error
        ? error.message
        : `Invalid sync entry local path: ${value}`,
    );
  }

  const relativePath = relative(homeDirectory, resolvedLocalPath);

  if (relativePath === "") {
    throw new DevsyncError(
      "Sync entry local path cannot be the home directory itself.",
      {
        code: "ENTRY_ROOT_DISALLOWED",
        details: [
          `Configured path: ${value}`,
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
        `Configured path: ${value}`,
        `Home directory: ${homeDirectory}`,
      ],
      hint: "Use a path under HOME, such as '~/...'.",
    });
  }

  return resolvedLocalPath;
};

export const deriveRepoPathFromLocalPath = (
  localPath: string,
  environment: NodeJS.ProcessEnv,
) => {
  const homeDirectory = resolveHomeDirectory(environment);
  const resolvedLocalPath = resolveSyncEntryLocalPath(localPath, environment);
  const relativePath = relative(homeDirectory, resolvedLocalPath);

  return normalizeSyncRepoPath(relativePath.replaceAll("\\", "/"));
};

const resolveConfiguredIdentityFile = (
  value: string,
  environment: NodeJS.ProcessEnv,
) => {
  try {
    return resolveConfiguredAbsolutePath(value, environment);
  } catch (error: unknown) {
    throw new DevsyncError(
      error instanceof Error
        ? error.message
        : `Invalid sync age identity file path: ${value}`,
    );
  }
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
      const overlaps =
        property === "repoPath"
          ? currentValue === otherValue ||
            currentValue.startsWith(`${otherValue}/`) ||
            otherValue.startsWith(`${currentValue}/`)
          : doPathsOverlap(currentValue, otherValue);

      if (overlaps) {
        throw new DevsyncError(
          `${description} paths must not overlap in config.json.`,
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

const validateOverrides = (entry: ResolvedSyncConfigEntry) => {
  if (entry.kind === "file" && entry.overrides.length > 0) {
    throw new DevsyncError("File sync entries cannot define overrides.", {
      code: "FILE_ENTRY_OVERRIDES",
      details: [`Entry: ${entry.name}`],
      hint: "Remove overrides or change the entry kind to 'directory'.",
    });
  }

  const seenOverrides = new Set<string>();

  for (const override of entry.overrides) {
    const key = formatSyncOverrideSelector(override);

    if (seenOverrides.has(key)) {
      throw new DevsyncError("Duplicate sync override found in config.json.", {
        code: "DUPLICATE_OVERRIDE",
        details: [
          `Entry: ${entry.name}`,
          `Override: ${formatSyncOverrideSelector(override)}`,
        ],
        hint: "Keep only one override selector in each entry.",
      });
    }

    seenOverrides.add(key);
  }
};

const buildNormalizedMachines = (
  entry: z.infer<typeof syncConfigEntrySchema>,
): Record<string, readonly string[]> => {
  if (entry.kind === "file") {
    if (entry.machines === undefined || entry.machines.length === 0) {
      return {};
    }

    for (const machine of entry.machines) {
      normalizeSyncMachineName(machine);
    }

    return { "": entry.machines };
  }

  if (entry.machines === undefined) {
    return {};
  }

  const normalized: Record<string, readonly string[]> = {};

  for (const [path, machineList] of Object.entries(entry.machines)) {
    const normalizedPath = normalizeSyncOverridePath(
      path,
      "Machine path selector",
    );

    for (const machine of machineList) {
      normalizeSyncMachineName(machine);
    }

    normalized[normalizedPath] = machineList;
  }

  return normalized;
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
      hint: "Fix the invalid fields in config.json, then run the command again.",
    });
  }

  const entries = result.data.entries.map((entry) => {
    const resolvedLocalPath = resolveSyncEntryLocalPath(
      entry.localPath,
      environment,
    );
    const repoPath = deriveRepoPathFromLocalPath(entry.localPath, environment);
    const machines = buildNormalizedMachines(entry);

    if (entry.kind === "file") {
      const mode = entry.mode ?? "normal";
      const resolved: ResolvedSyncConfigEntry = {
        configuredLocalPath: entry.localPath,
        kind: entry.kind,
        localPath: resolvedLocalPath,
        machines,
        mode,
        modeExplicit: entry.mode !== undefined,
        name: repoPath,
        overrides: [],
        repoPath,
      };

      validateOverrides(resolved);

      return resolved;
    }

    const dirMode = entry.mode ?? "normal";
    const resolved: ResolvedSyncConfigEntry = {
      configuredLocalPath: entry.localPath,
      kind: entry.kind,
      localPath: resolvedLocalPath,
      machines,
      mode: dirMode,
      modeExplicit: entry.mode !== undefined,
      name: repoPath,
      overrides: buildResolvedOverrides(entry.rules, "Rule selector"),
      repoPath,
    };

    validateOverrides(resolved);

    return resolved;
  });

  validateResolvedSyncConfigEntries(entries);

  return {
    age: {
      configuredIdentityFile: result.data.age.identityFile,
      identityFile: resolveConfiguredIdentityFile(
        result.data.age.identityFile,
        environment,
      ),
      recipients: [...new Set(result.data.age.recipients)],
    },
    entries,
    version: 3,
  };
};

export const createInitialSyncConfig = (input: {
  identityFile: string;
  recipients: readonly string[];
}): SyncConfig => {
  return {
    version: 3,
    age: {
      identityFile: input.identityFile,
      recipients: [
        ...new Set(input.recipients.map((recipient) => recipient.trim())),
      ],
    },
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
        hint: "Fix the JSON syntax in config.json, then run the command again.",
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

export const resolveSyncRule = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeMachine?: string,
): { mode: SyncMode; machine: string } | undefined => {
  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined) {
    return undefined;
  }

  const relativePath = resolveEntryRelativeRepoPath(entry, repoPath);

  if (relativePath === undefined) {
    return undefined;
  }

  return resolveRelativeSyncRule(entry, relativePath, activeMachine);
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
    for (const machineList of Object.values(entry.machines)) {
      for (const machine of machineList) {
        machines.add(machine);
      }
    }
  }

  return [...machines].sort((left, right) => left.localeCompare(right));
};
