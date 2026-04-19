import { isAbsolute, relative, resolve } from "node:path";

import type { PlatformStringValue } from "#app/config/platform.ts";
import {
  normalizeSyncRepoPath,
  type ResolvedSyncConfigEntry,
} from "#app/config/sync.ts";
import { expandHomePath } from "#app/config/xdg.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { isExplicitLocalPath } from "#app/lib/path.ts";

const homePrefix = "~";
const shellPathSeparator = "/";

export const buildRepoPathWithinRoot = (
  absolutePath: string,
  rootPath: string,
  description: string,
) => {
  const relativePath = relative(rootPath, absolutePath);

  if (relativePath === "") {
    throw new DotweaveError(
      `${description} resolves to the root directory, which cannot be tracked directly.`,
      {
        code: "TARGET_ROOT_DISALLOWED",
        details: [`Target: ${absolutePath}`, `Root: ${rootPath}`],
        hint: `Choose a file or subdirectory inside ${rootPath}.`,
      },
    );
  }

  if (
    isAbsolute(relativePath) ||
    relativePath.startsWith("..") ||
    relativePath === ".."
  ) {
    throw new DotweaveError(
      `${description} must stay inside the configured home root.`,
      {
        code: "TARGET_OUTSIDE_ROOT",
        details: [`Target: ${absolutePath}`, `Allowed root: ${rootPath}`],
        hint: `Use a path inside ${rootPath}.`,
      },
    );
  }

  return normalizeSyncRepoPath(relativePath);
};

export const buildConfiguredHomeLocalPath = (
  repoPath: string,
): PlatformStringValue => {
  return {
    default: `${homePrefix}${shellPathSeparator}${repoPath}`,
  };
};

export const tryBuildRepoPathWithinRoot = (
  absolutePath: string,
  rootPath: string,
  description: string,
) => {
  try {
    return buildRepoPathWithinRoot(absolutePath, rootPath, description);
  } catch {
    return undefined;
  }
};

export const tryNormalizeRepoPathInput = (value: string) => {
  try {
    return normalizeSyncRepoPath(value);
  } catch {
    return undefined;
  }
};

export const resolveTrackedEntry = (
  target: string,
  entries: readonly ResolvedSyncConfigEntry[],
  cwd: string,
  homeDirectory: string,
): ResolvedSyncConfigEntry | undefined => {
  const resolvedTargetPath = resolve(
    cwd,
    expandHomePath(target, homeDirectory),
  );
  const byLocalPath = entries.filter(
    (entry) => entry.localPath === resolvedTargetPath,
  );

  let matches: typeof byLocalPath;

  if (byLocalPath.length > 0 || isExplicitLocalPath(target)) {
    matches = byLocalPath;
  } else {
    const normalizedRepoPath = tryNormalizeRepoPathInput(target);
    matches =
      normalizedRepoPath === undefined
        ? []
        : entries.filter((entry) => entry.repoPath === normalizedRepoPath);
  }

  if (matches.length > 1) {
    throw new DotweaveError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path to choose the tracked entry.",
    });
  }

  return matches[0];
};
