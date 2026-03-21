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

const syncLayerSchema = z
  .object({
    mode: z.enum(syncModes).optional(),
    rules: syncOverrideMapSchema.optional(),
  })
  .strict()
  .superRefine((layer, context) => {
    if (layer.mode === undefined && layer.rules === undefined) {
      context.addIssue({
        code: "custom",
        message: "Each sync layer must define a mode, rules, or both.",
      });
    }
  });

const syncMachinesSchema = z.record(
  requiredTrimmedStringSchema,
  syncLayerSchema,
);

const syncConfigEntrySchema = z
  .object({
    base: syncLayerSchema.optional(),
    kind: z.enum(syncEntryKinds),
    localPath: requiredTrimmedStringSchema,
    machines: syncMachinesSchema.optional(),
    repoPath: requiredTrimmedStringSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.base === undefined && entry.machines === undefined) {
      context.addIssue({
        code: "custom",
        message:
          "Sync entries must define a base layer, machine layers, or both.",
      });
    }

    if (entry.kind !== "file") {
      return;
    }

    if (entry.base?.rules !== undefined) {
      context.addIssue({
        code: "custom",
        message: "File sync entries cannot define rules.",
        path: ["base", "rules"],
      });
    }

    for (const [machineName, layer] of Object.entries(entry.machines ?? {})) {
      if (layer.rules === undefined) {
        continue;
      }

      context.addIssue({
        code: "custom",
        message: "File sync entries cannot define rules.",
        path: ["machines", machineName, "rules"],
      });
    }
  });

const syncConfigSchema = z
  .object({
    version: z.literal(2),
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
  machine?: string;
  machineLayer?: string;
  machineMode?: SyncMode;
  machineModeExplicit?: boolean;
  machineOverrides?: readonly ResolvedSyncOverride[];
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
  version: 2;
}>;

const createResolvedEntryName = (input: {
  machine?: string;
  repoPath: string;
}) => {
  return input.machine === undefined
    ? input.repoPath
    : `${input.repoPath}#${input.machine}`;
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

  if (normalizedValue === "base") {
    throw new DevsyncError(`${description} uses a reserved name.`, {
      code: "INVALID_MACHINE_NAME",
      details: [`${description}: ${value}`],
      hint: "Use another name like 'work' or 'personal'; 'base' is reserved for the shared sync namespace.",
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

const buildResolvedEntry = (input: {
  configuredLocalPath: string;
  kind: SyncConfigEntryKind;
  localPath: string;
  mode: SyncMode;
  modeExplicit: boolean;
  overrides: readonly ResolvedSyncOverride[];
  machine?: string;
  repoPath: string;
}) => {
  return {
    configuredLocalPath: input.configuredLocalPath,
    kind: input.kind,
    localPath: input.localPath,
    mode: input.mode,
    modeExplicit: input.modeExplicit,
    name: createResolvedEntryName({
      machine: input.machine,
      repoPath: input.repoPath,
    }),
    overrides: input.overrides,
    ...(input.machine === undefined ? {} : { machine: input.machine }),
    repoPath: input.repoPath,
  } satisfies ResolvedSyncConfigEntry;
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

export const resolveRelativeSyncRule = (
  entry: Pick<
    ResolvedSyncConfigEntry,
    | "machine"
    | "machineLayer"
    | "machineMode"
    | "machineModeExplicit"
    | "machineOverrides"
    | "mode"
    | "overrides"
  >,
  relativePath: string,
  activeMachine: string | undefined,
) => {
  if (entry.machine !== undefined && entry.machine !== activeMachine) {
    return undefined;
  }

  if (relativePath === "") {
    if (
      entry.machine === undefined &&
      entry.machineLayer !== undefined &&
      entry.machineModeExplicit &&
      activeMachine === entry.machineLayer
    ) {
      return {
        machine: entry.machineLayer,
        mode: entry.machineMode ?? entry.mode,
      };
    }

    return {
      mode: entry.mode,
      ...(entry.machine === undefined ? {} : { machine: entry.machine }),
    };
  }

  const matchingMachineOverride =
    activeMachine !== undefined &&
    entry.machineLayer === activeMachine &&
    entry.machineOverrides !== undefined
      ? [...entry.machineOverrides]
          .filter((override) => {
            return matchesOverride(override, relativePath);
          })
          .sort(compareOverrideSpecificity)[0]
      : undefined;

  if (matchingMachineOverride !== undefined) {
    return {
      machine: activeMachine,
      mode: matchingMachineOverride.mode,
    };
  }

  const matchingOverride = [...entry.overrides]
    .filter((override) => {
      return matchesOverride(override, relativePath);
    })
    .sort(compareOverrideSpecificity)[0];

  if (matchingOverride !== undefined) {
    return {
      mode: matchingOverride.mode,
      ...(entry.machine === undefined ? {} : { machine: entry.machine }),
    };
  }

  if (
    entry.machine === undefined &&
    entry.machineLayer !== undefined &&
    entry.machineModeExplicit &&
    activeMachine === entry.machineLayer
  ) {
    return {
      machine: entry.machineLayer,
      mode: entry.machineMode ?? entry.mode,
    };
  }

  return {
    mode: entry.mode,
    ...(entry.machine === undefined ? {} : { machine: entry.machine }),
  };
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

const canEntriesShareNamespace = (
  left: Pick<ResolvedSyncConfigEntry, "machine">,
  right: Pick<ResolvedSyncConfigEntry, "machine">,
) => {
  return (
    left.machine !== undefined &&
    right.machine !== undefined &&
    left.machine !== right.machine
  );
};

const areMachineVariantsOfSameEntry = (
  left: Pick<
    ResolvedSyncConfigEntry,
    "kind" | "localPath" | "machine" | "repoPath"
  >,
  right: Pick<
    ResolvedSyncConfigEntry,
    "kind" | "localPath" | "machine" | "repoPath"
  >,
) => {
  return (
    left.kind === right.kind &&
    left.localPath === right.localPath &&
    left.repoPath === right.repoPath &&
    left.machine !== right.machine
  );
};

const validatePathOverlaps = (
  entries: readonly ResolvedSyncConfigEntry[],
  property: "localPath" | "repoPath",
  description: string,
  options: Readonly<{
    allowMachineDisjointOverlaps: boolean;
  }>,
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
        if (
          options.allowMachineDisjointOverlaps &&
          (canEntriesShareNamespace(currentEntry, otherEntry) ||
            areMachineVariantsOfSameEntry(currentEntry, otherEntry))
        ) {
          continue;
        }

        throw new DevsyncError(
          `${description} paths must not overlap in config.json.`,
          {
            code: "OVERLAPPING_PATHS",
            details: [
              `${currentEntry.name}: ${currentValue}`,
              `${otherEntry.name}: ${otherValue}`,
              ...(currentEntry.machine === undefined
                ? []
                : [`${currentEntry.name} machine: ${currentEntry.machine}`]),
              ...(otherEntry.machine === undefined
                ? []
                : [`${otherEntry.name} machine: ${otherEntry.machine}`]),
            ],
            hint: "Split overlapping entries so each tracked root owns a distinct path.",
          },
        );
      }
    }
  }
};

const validateMachineRepoPathConflicts = (
  entries: readonly ResolvedSyncConfigEntry[],
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

      if (currentEntry.repoPath !== otherEntry.repoPath) {
        continue;
      }

      if (currentEntry.machine !== otherEntry.machine) {
        continue;
      }

      throw new DevsyncError(
        "Repository paths must be unique within the same machine namespace.",
        {
          code: "OVERLAPPING_PATHS",
          details: [
            `${currentEntry.name}: ${currentEntry.repoPath}`,
            `${otherEntry.name}: ${otherEntry.repoPath}`,
          ],
          hint: "Use distinct repository paths, or assign the entries to different non-default machines.",
        },
      );
    }
  }
};

export const validateResolvedSyncConfigEntries = (
  entries: readonly ResolvedSyncConfigEntry[],
  options: Readonly<{
    allowMachineDisjointOverlaps: boolean;
  }> = {
    allowMachineDisjointOverlaps: false,
  },
) => {
  validateMachineRepoPathConflicts(entries);
  validatePathOverlaps(entries, "repoPath", "Repository", options);
  validatePathOverlaps(entries, "localPath", "Local", options);
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
        hint: "Keep only one override selector in each entry namespace.",
      });
    }

    seenOverrides.add(key);
  }
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

  const entries = result.data.entries.flatMap((entry) => {
    const resolvedRepoPath = normalizeSyncRepoPath(entry.repoPath);
    const resolvedLocalPath = resolveSyncEntryLocalPath(
      entry.localPath,
      environment,
    );
    const resolvedEntries: ResolvedSyncConfigEntry[] = [];
    const baseMode = entry.base?.mode;

    if (entry.base !== undefined) {
      if (entry.base.mode === undefined) {
        throw new DevsyncError(
          "Base layers must define a mode in config.json.",
          {
            code: "CONFIG_VALIDATION_FAILED",
            details: [`Entry: ${entry.repoPath}`],
            hint: "Set base.mode for shared tracked roots.",
          },
        );
      }

      resolvedEntries.push(
        buildResolvedEntry({
          configuredLocalPath: entry.localPath,
          kind: entry.kind,
          localPath: resolvedLocalPath,
          mode: entry.base.mode,
          modeExplicit: true,
          overrides: buildResolvedOverrides(
            entry.base.rules,
            "Base rule selector",
          ),
          repoPath: resolvedRepoPath,
        }),
      );
    }

    for (const [machineName, machineLayer] of Object.entries(
      entry.machines ?? {},
    )) {
      const machine = normalizeSyncMachineName(machineName);
      const mode = machineLayer.mode ?? baseMode;

      if (mode === undefined) {
        throw new DevsyncError(
          "Machine layers must define a mode unless the base layer provides one.",
          {
            code: "CONFIG_VALIDATION_FAILED",
            details: [`Entry: ${entry.repoPath}`, `Machine: ${machine}`],
            hint: "Set machines.<name>.mode, or add base.mode for the shared root.",
          },
        );
      }

      resolvedEntries.push(
        buildResolvedEntry({
          configuredLocalPath: entry.localPath,
          kind: entry.kind,
          localPath: resolvedLocalPath,
          mode,
          modeExplicit: machineLayer.mode !== undefined,
          overrides: buildResolvedOverrides(
            machineLayer.rules,
            `Machine rule selector (${machine})`,
          ),
          machine,
          repoPath: resolvedRepoPath,
        }),
      );
    }

    resolvedEntries.forEach(validateOverrides);

    return resolvedEntries;
  });

  validateResolvedSyncConfigEntries(entries, {
    allowMachineDisjointOverlaps: true,
  });

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
    version: 2,
  };
};

export const createInitialSyncConfig = (input: {
  identityFile: string;
  recipients: readonly string[];
}): SyncConfig => {
  return {
    version: 2,
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

export const resolveSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeMachine?: string,
): SyncMode | undefined => {
  return resolveSyncRule(config, repoPath, activeMachine)?.mode;
};

export const resolveSyncRule = (
  config: ResolvedSyncConfig,
  repoPath: string,
  activeMachine?: string,
) => {
  const matchingEntries = config.entries.filter((entry) => {
    return matchesEntryPath(entry, repoPath);
  });
  const baseEntry = matchingEntries.find(
    (entry) => entry.machine === undefined,
  );
  const machineEntry =
    activeMachine === undefined
      ? undefined
      : matchingEntries.find((entry) => entry.machine === activeMachine);

  if (baseEntry === undefined && machineEntry === undefined) {
    return undefined;
  }

  const ownerEntry = baseEntry ?? machineEntry;
  const relativePath =
    ownerEntry === undefined
      ? undefined
      : resolveEntryRelativeRepoPath(ownerEntry, repoPath);

  if (relativePath === undefined) {
    return undefined;
  }

  if (baseEntry === undefined && machineEntry !== undefined) {
    return resolveRelativeSyncRule(machineEntry, relativePath, activeMachine);
  }

  if (baseEntry === undefined) {
    return undefined;
  }

  if (machineEntry === undefined) {
    return resolveRelativeSyncRule(baseEntry, relativePath, activeMachine);
  }

  return resolveRelativeSyncRule(
    {
      ...baseEntry,
      machineLayer: machineEntry.machine,
      machineMode: machineEntry.mode,
      machineModeExplicit: machineEntry.modeExplicit,
      machineOverrides: machineEntry.overrides,
    },
    relativePath,
    activeMachine,
  );
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
  activeMachineOrContext?: string,
  context?: string,
) => {
  const activeMachine = activeMachineOrContext;
  const resolvedContext = context;
  const mode = resolveSyncMode(config, repoPath, activeMachine);

  if (mode === undefined) {
    throw new DevsyncError(
      "Repository path is not managed by the current sync configuration.",
      {
        code: "UNMANAGED_SYNC_PATH",
        details: [
          `Repository path: ${repoPath}`,
          ...(resolvedContext === undefined
            ? []
            : [`Context: ${resolvedContext}`]),
        ],
        hint: "Add the parent path to devsync, or remove stray artifacts from the sync repository.",
      },
    );
  }

  return mode;
};
