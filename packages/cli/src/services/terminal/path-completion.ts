import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { DotweaveCliContext } from "#app/services/terminal/cli-runtime.ts";

const HOME_PREFIX = "~";
const HIDDEN_ENTRY_PREFIX = ".";
const RECOVERABLE_ERROR_CODES = new Set<string>([
  "EACCES",
  "ENOENT",
  "ENOTDIR",
]);
const SHELL_PATH_SEPARATOR = "/";

type CompletionBase = Readonly<{
  absoluteDirectory: string;
  displayPrefix: string;
  entryPrefix: string;
}>;

const isRecoverableCompletionError = (error: unknown) => {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    RECOVERABLE_ERROR_CODES.has(error.code)
  );
};

const buildRelativeCompletionBase = (partial: string): CompletionBase => {
  const lastSeparatorIndex = partial.lastIndexOf(SHELL_PATH_SEPARATOR);
  const displayPrefix =
    lastSeparatorIndex < 0 ? "" : partial.slice(0, lastSeparatorIndex + 1);
  const entryPrefix =
    lastSeparatorIndex < 0 ? partial : partial.slice(lastSeparatorIndex + 1);

  return {
    absoluteDirectory: path.resolve(
      process.cwd(),
      displayPrefix === "" ? "." : displayPrefix,
    ),
    displayPrefix,
    entryPrefix,
  };
};

const buildAbsoluteCompletionBase = (partial: string): CompletionBase => {
  const lastSeparatorIndex = partial.lastIndexOf(SHELL_PATH_SEPARATOR);
  const displayPrefix =
    lastSeparatorIndex < 0
      ? SHELL_PATH_SEPARATOR
      : partial.slice(0, lastSeparatorIndex + 1);
  const entryPrefix =
    lastSeparatorIndex < 0 ? partial : partial.slice(lastSeparatorIndex + 1);

  return {
    absoluteDirectory: path.resolve(displayPrefix),
    displayPrefix,
    entryPrefix,
  };
};

const buildHomeCompletionBase = (
  partial: string,
): CompletionBase | undefined => {
  if (partial === HOME_PREFIX) {
    return {
      absoluteDirectory: os.homedir(),
      displayPrefix: `${HOME_PREFIX}${SHELL_PATH_SEPARATOR}`,
      entryPrefix: "",
    };
  }

  if (!partial.startsWith(`${HOME_PREFIX}${SHELL_PATH_SEPARATOR}`)) {
    return undefined;
  }

  const homeRelativePath = partial.slice(2);
  const lastSeparatorIndex = homeRelativePath.lastIndexOf(SHELL_PATH_SEPARATOR);
  const directorySuffix =
    lastSeparatorIndex < 0
      ? ""
      : homeRelativePath.slice(0, lastSeparatorIndex + 1);
  const entryPrefix =
    lastSeparatorIndex < 0
      ? homeRelativePath
      : homeRelativePath.slice(lastSeparatorIndex + 1);

  return {
    absoluteDirectory: path.resolve(
      os.homedir(),
      directorySuffix === "" ? "." : directorySuffix,
    ),
    displayPrefix: `${HOME_PREFIX}${SHELL_PATH_SEPARATOR}${directorySuffix}`,
    entryPrefix,
  };
};

const resolveCompletionBase = (partial: string): CompletionBase | undefined => {
  if (partial.startsWith(HOME_PREFIX)) {
    return buildHomeCompletionBase(partial);
  }

  if (partial.startsWith(SHELL_PATH_SEPARATOR)) {
    return buildAbsoluteCompletionBase(partial);
  }

  return buildRelativeCompletionBase(partial);
};

const shouldIncludeEntry = (name: string, entryPrefix: string) => {
  if (!name.startsWith(entryPrefix)) {
    return false;
  }

  if (
    !entryPrefix.startsWith(HIDDEN_ENTRY_PREFIX) &&
    name.startsWith(HIDDEN_ENTRY_PREFIX)
  ) {
    return false;
  }

  return true;
};

const buildCompletionValue = (
  base: CompletionBase,
  entryName: string,
  isDirectory: boolean,
) => {
  const completion = `${base.displayPrefix}${entryName}`;

  return isDirectory ? `${completion}${SHELL_PATH_SEPARATOR}` : completion;
};

export const proposePathCompletions = async function (
  this: DotweaveCliContext,
  partial: string,
) {
  const base = resolveCompletionBase(partial);

  if (base === undefined) {
    return [];
  }

  try {
    const entries = await fs.readdir(base.absoluteDirectory, {
      withFileTypes: true,
    });

    return entries
      .filter((entry) => shouldIncludeEntry(entry.name, base.entryPrefix))
      .map((entry) => {
        return buildCompletionValue(base, entry.name, entry.isDirectory());
      })
      .sort((left: string, right: string) => left.localeCompare(right));
  } catch (error) {
    if (isRecoverableCompletionError(error)) {
      return [];
    }

    throw error;
  }
};
