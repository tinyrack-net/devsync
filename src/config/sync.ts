import { readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative } from "node:path";

import { z } from "zod";
import {
  resolveConfiguredAbsolutePath,
  resolveDevtoolsSyncDirectory,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
} from "#app/config/xdg.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import { formatInputIssues } from "#app/lib/validation.ts";

export const syncConfigFileName = "config.json";
export const syncPlainDirectoryName = "plain";
export const syncSecretDirectoryName = "secret";

const syncEntryKinds = ["file", "directory"] as const;

const requiredTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, "Value must not be empty.");

const syncConfigEntrySchema = z.object({
  name: requiredTrimmedStringSchema,
  kind: z.enum(syncEntryKinds),
  ignoreGlobs: z.array(requiredTrimmedStringSchema).optional(),
  localPath: requiredTrimmedStringSchema,
  repoPath: requiredTrimmedStringSchema,
  secretGlobs: z.array(requiredTrimmedStringSchema).optional(),
});

const syncConfigSchema = z.object({
  version: z.literal(1),
  age: z.object({
    recipients: z
      .array(requiredTrimmedStringSchema)
      .min(1, "At least one age recipient is required."),
    identityFile: requiredTrimmedStringSchema,
  }),
  entries: z.array(syncConfigEntrySchema),
  ignoreGlobs: z.array(requiredTrimmedStringSchema),
  secretGlobs: z.array(requiredTrimmedStringSchema),
});

export type SyncConfigEntryKind = (typeof syncEntryKinds)[number];
export type SyncConfig = z.infer<typeof syncConfigSchema>;

export type ResolvedSyncConfigEntry = Readonly<{
  configuredLocalPath: string;
  ignoreGlobs: readonly string[];
  kind: SyncConfigEntryKind;
  localPath: string;
  name: string;
  repoPath: string;
  secretGlobs: readonly string[];
}>;

export type ResolvedSyncConfig = Readonly<{
  age: Readonly<{
    configuredIdentityFile: string;
    identityFile: string;
    recipients: readonly string[];
  }>;
  entries: readonly ResolvedSyncConfigEntry[];
  ignoreGlobs: readonly string[];
  secretGlobs: readonly string[];
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

  return normalizedValue;
};

const normalizeEntryScopedGlob = (value: string, description: string) => {
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
      `${description} must be a relative POSIX pattern without '..': ${value}`,
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
      `${description} must be a relative POSIX pattern without '..': ${value}`,
    );
  }

  return normalizedValue;
};

const findOwningEntry = (
  config: ResolvedSyncConfig,
  repoPath: string,
): ResolvedSyncConfigEntry | undefined => {
  return config.entries.find((entry) => {
    return (
      entry.repoPath === repoPath ||
      (entry.kind === "directory" && repoPath.startsWith(`${entry.repoPath}/`))
    );
  });
};

const resolveEntryRelativePath = (
  entry: ResolvedSyncConfigEntry,
  repoPath: string,
) => {
  if (entry.kind === "file") {
    return repoPath === entry.repoPath ? "*" : undefined;
  }

  if (repoPath === entry.repoPath) {
    return "";
  }

  if (!repoPath.startsWith(`${entry.repoPath}/`)) {
    return undefined;
  }

  return repoPath.slice(entry.repoPath.length + 1);
};

const matchesScopedGlobList = (
  config: ResolvedSyncConfig,
  repoPath: string,
  selector: (entry: ResolvedSyncConfigEntry) => readonly string[],
  globalGlobs: readonly string[],
) => {
  if (
    globalGlobs.some((pattern) => {
      return posix.matchesGlob(repoPath, pattern);
    })
  ) {
    return true;
  }

  const owningEntry = findOwningEntry(config, repoPath);

  if (owningEntry === undefined) {
    return false;
  }

  const entryRelativePath = resolveEntryRelativePath(owningEntry, repoPath);

  if (entryRelativePath === undefined) {
    return false;
  }

  return selector(owningEntry).some((pattern) => {
    return posix.matchesGlob(entryRelativePath, pattern);
  });
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

export const parseSyncConfig = (
  input: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedSyncConfig => {
  const result = syncConfigSchema.safeParse(input);

  if (!result.success) {
    throw new SyncConfigError(formatInputIssues(result.error.issues));
  }

  const entries = result.data.entries.map((entry) => {
    return {
      configuredLocalPath: entry.localPath,
      ignoreGlobs: (entry.ignoreGlobs ?? []).map((glob) => {
        return normalizeEntryScopedGlob(glob, "Entry ignore glob");
      }),
      kind: entry.kind,
      localPath: resolveSyncEntryLocalPath(entry.localPath, environment),
      name: entry.name,
      repoPath: normalizeSyncRepoPath(entry.repoPath),
      secretGlobs: (entry.secretGlobs ?? []).map((glob) => {
        return normalizeEntryScopedGlob(glob, "Entry secret glob");
      }),
    } satisfies ResolvedSyncConfigEntry;
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
    ignoreGlobs: result.data.ignoreGlobs.map((glob) => {
      return glob.replaceAll("\\", "/");
    }),
    secretGlobs: result.data.secretGlobs.map((glob) => {
      return glob.replaceAll("\\", "/");
    }),
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
    ignoreGlobs: [],
    secretGlobs: [],
  };
};

export const formatSyncConfig = (config: SyncConfig) => {
  return ensureTrailingNewline(JSON.stringify(config, null, 2));
};

export const resolveSyncConfigPath = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return posix.join(
    resolveDevtoolsSyncDirectory(environment).replaceAll("\\", "/"),
    syncConfigFileName,
  );
};

export const resolveSyncConfigFilePath = (
  syncDirectory: string = resolveDevtoolsSyncDirectory(),
) => {
  return join(syncDirectory, syncConfigFileName);
};

export const resolveSyncPlainDirectoryPath = (syncDirectory: string) => {
  return join(syncDirectory, syncPlainDirectoryName);
};

export const resolveSyncSecretDirectoryPath = (syncDirectory: string) => {
  return join(syncDirectory, syncSecretDirectoryName);
};

export const readSyncConfig = async (
  syncDirectory: string = resolveDevtoolsSyncDirectory(),
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

export const matchesIgnoreGlob = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  return matchesScopedGlobList(
    config,
    repoPath,
    (entry) => {
      return entry.ignoreGlobs;
    },
    config.ignoreGlobs,
  );
};

export const matchesSecretGlob = (
  config: ResolvedSyncConfig,
  repoPath: string,
) => {
  if (matchesIgnoreGlob(config, repoPath)) {
    return false;
  }

  return matchesScopedGlobList(
    config,
    repoPath,
    (entry) => {
      return entry.secretGlobs;
    },
    config.secretGlobs,
  );
};
