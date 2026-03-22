import { isAbsolute, relative, resolve } from "node:path";

import {
  normalizeSyncRepoPath,
  type ResolvedSyncConfigEntry,
} from "#app/config/sync.ts";
import { expandHomePath } from "#app/config/xdg.ts";

import { isExplicitLocalPath } from "#app/lib/path.ts";

export {
  buildDirectoryKey,
  doPathsOverlap,
  isExplicitLocalPath,
  isPathEqualOrNested,
} from "#app/lib/path.ts";

import { DevsyncError } from "./error.ts";

export const resolveCommandTargetPath = (
  target: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => {
  return resolve(cwd, expandHomePath(target, environment));
};

export const buildRepoPathWithinRoot = (
  absolutePath: string,
  rootPath: string,
  description: string,
) => {
  const relativePath = relative(rootPath, absolutePath);

  if (relativePath === "") {
    throw new DevsyncError(
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
    throw new DevsyncError(
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

export const buildConfiguredHomeLocalPath = (repoPath: string) => {
  return `~/${repoPath}`;
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
  context: Readonly<{ cwd: string; environment: NodeJS.ProcessEnv }>,
): ResolvedSyncConfigEntry | undefined => {
  const resolvedTargetPath = resolveCommandTargetPath(
    target,
    context.environment,
    context.cwd,
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
    throw new DevsyncError(`Multiple tracked sync entries match: ${target}`, {
      code: "TARGET_CONFLICT",
      hint: "Use an explicit local path to choose the tracked entry.",
    });
  }

  return matches[0];
};
