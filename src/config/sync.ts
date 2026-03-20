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

export const syncConfigFileName = "config.json";
export const syncArtifactsDirectoryName = "files";
export const syncSecretArtifactSuffix = ".devsync.secret";

const syncEntryKinds = ["file", "directory"] as const;
export const syncModes = ["normal", "secret", "ignore"] as const;

const requiredTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, "Value must not be empty.");

const syncConfigEntrySchema = z
  .object({
    kind: z.enum(syncEntryKinds),
    localPath: requiredTrimmedStringSchema,
    mode: z.enum(syncModes),
    name: requiredTrimmedStringSchema,
    overrides: z
      .record(requiredTrimmedStringSchema, z.enum(syncModes))
      .optional(),
    repoPath: requiredTrimmedStringSchema,
  })
  .strict();

const syncConfigSchema = z
  .object({
    version: z.literal(1),
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
  mode: SyncMode;
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
  version: 1;
}>;

export class SyncConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SyncConfigError";
  }
}

export const normalizeSyncRepoPath = (value: string) => {
  const normalizedValue = posix.normalize(value.replaceAll("\\", "/"));

  if (
    normalizedValue === "" ||
    normalizedValue === "." ||
    normalizedValue.startsWith("../") ||
    normalizedValue.includes("/../") ||
    normalizedValue.startsWith("/")
  ) {
    throw new SyncConfigError(
      `Repository path must be a relative POSIX path without '..': ${value}`,
    );
  }

  if (hasReservedSyncArtifactSuffixSegment(normalizedValue)) {
    throw new SyncConfigError(
      `Repository path must not use the reserved suffix ${syncSecretArtifactSuffix}: ${value}`,
    );
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
    throw new SyncConfigError(
      `${description} must be a relative POSIX path without '..': ${value}`,
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
    throw new SyncConfigError(
      `${description} must be a relative POSIX path without '..': ${value}`,
    );
  }

  if (hasReservedSyncArtifactSuffixSegment(normalizedValue)) {
    throw new SyncConfigError(
      `${description} must not use the reserved suffix ${syncSecretArtifactSuffix}: ${value}`,
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

export const findOwningSyncEntry = (
  config: Pick<ResolvedSyncConfig, "entries">,
  repoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  return config.entries.find((entry) => {
    return (
      entry.repoPath === repoPath ||
      (entry.kind === "directory" && repoPath.startsWith(`${entry.repoPath}/`))
    );
  });
};

const resolveEntryRelativeRepoPath = (
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

const isPathEqualOrNested = (left: string, right: string) => {
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);

  const leftContainsRight =
    leftToRight === "" ||
    (!isAbsolute(leftToRight) &&
      !leftToRight.startsWith("..") &&
      leftToRight !== "..");
  const rightContainsLeft =
    rightToLeft === "" ||
    (!isAbsolute(rightToLeft) &&
      !rightToLeft.startsWith("..") &&
      rightToLeft !== "..");

  return leftContainsRight || rightContainsLeft;
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
    throw new SyncConfigError(
      error instanceof Error
        ? error.message
        : `Invalid sync entry local path: ${value}`,
    );
  }

  const relativePath = relative(homeDirectory, resolvedLocalPath);

  if (relativePath === "") {
    throw new SyncConfigError(
      `Sync entry local path must be inside ${homeDirectory}, not the home directory itself: ${value}`,
    );
  }

  if (
    isAbsolute(relativePath) ||
    relativePath.startsWith("..") ||
    relativePath === ".."
  ) {
    throw new SyncConfigError(
      `Sync entry local path must be inside ${homeDirectory}: ${value}`,
    );
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
    throw new SyncConfigError(
      error instanceof Error
        ? error.message
        : `Invalid sync age identity file path: ${value}`,
    );
  }
};

const validateUniqueNames = (entries: readonly ResolvedSyncConfigEntry[]) => {
  const seenNames = new Set<string>();

  for (const entry of entries) {
    if (seenNames.has(entry.name)) {
      throw new SyncConfigError(`Duplicate sync entry name: ${entry.name}`);
    }

    seenNames.add(entry.name);
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
          : isPathEqualOrNested(currentValue, otherValue);

      if (overlaps) {
        throw new SyncConfigError(
          `${description} paths must not overlap: ${currentEntry.name} (${currentValue}) and ${otherEntry.name} (${otherValue})`,
        );
      }
    }
  }
};

const validateOverrides = (entry: ResolvedSyncConfigEntry) => {
  if (entry.kind === "file" && entry.overrides.length > 0) {
    throw new SyncConfigError(
      `File sync entries must not define overrides: ${entry.name}`,
    );
  }

  const seenOverrides = new Set<string>();

  for (const override of entry.overrides) {
    const key = formatSyncOverrideSelector(override);

    if (seenOverrides.has(key)) {
      throw new SyncConfigError(
        `Duplicate sync override for ${entry.name}: ${key}`,
      );
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
    throw new SyncConfigError(formatInputIssues(result.error.issues));
  }

  const entries = result.data.entries.map((entry) => {
    const resolvedEntry = {
      configuredLocalPath: entry.localPath,
      kind: entry.kind,
      localPath: resolveSyncEntryLocalPath(entry.localPath, environment),
      mode: entry.mode,
      name: entry.name,
      overrides: Object.entries(entry.overrides ?? {}).map(
        ([selector, overrideMode]) => {
          const normalizedSelector = normalizeSyncOverrideSelector(
            selector,
            "Entry override selector",
          );

          return {
            ...normalizedSelector,
            mode: overrideMode,
          } satisfies ResolvedSyncOverride;
        },
      ),
      repoPath: normalizeSyncRepoPath(entry.repoPath),
    } satisfies ResolvedSyncConfigEntry;

    validateOverrides(resolvedEntry);

    return resolvedEntry;
  });

  validateUniqueNames(entries);
  validatePathOverlaps(entries, "repoPath", "Repository");
  validatePathOverlaps(entries, "localPath", "Local");

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
    version: 1,
  };
};

export const createInitialSyncConfig = (input: {
  identityFile: string;
  recipients: readonly string[];
}): SyncConfig => {
  return {
    version: 1,
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
  return join(syncDirectory, syncArtifactsDirectoryName);
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
    if (error instanceof SyncConfigError) {
      throw error;
    }

    if (error instanceof SyntaxError) {
      throw new SyncConfigError(
        `Sync configuration is not valid JSON: ${error.message}`,
      );
    }

    throw new SyncConfigError(
      error instanceof Error
        ? error.message
        : "Failed to read sync configuration.",
    );
  }
};

export const resolveSyncMode = (
  config: ResolvedSyncConfig,
  repoPath: string,
): SyncMode | undefined => {
  const entry = findOwningSyncEntry(config, repoPath);

  if (entry === undefined) {
    return undefined;
  }

  const relativePath = resolveEntryRelativeRepoPath(entry, repoPath);

  if (relativePath === undefined) {
    return undefined;
  }

  return resolveRelativeSyncMode(entry.mode, entry.overrides, relativePath);
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
