import { relative, resolve } from "node:path";

import { normalizeSyncRepoPath } from "#app/config/sync.ts";
import { expandConfiguredPath } from "#app/config/xdg.ts";

import { SyncError } from "./error.ts";

export const buildDirectoryKey = (repoPath: string) => {
  return `${repoPath}/`;
};

export const isPathEqualOrNested = (path: string, rootPath: string) => {
  const rootToPath = relative(rootPath, path);

  return (
    rootToPath === "" || (!rootToPath.startsWith("..") && rootToPath !== "..")
  );
};

export const doPathsOverlap = (leftPath: string, rightPath: string) => {
  return (
    isPathEqualOrNested(leftPath, rightPath) ||
    isPathEqualOrNested(rightPath, leftPath)
  );
};

export const resolveCommandTargetPath = (
  target: string,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) => {
  return resolve(cwd, expandConfiguredPath(target, environment));
};

export const buildRepoPathWithinRoot = (
  absolutePath: string,
  rootPath: string,
  description: string,
) => {
  const relativePath = relative(rootPath, absolutePath);

  if (relativePath === "") {
    throw new SyncError(
      `${description} must be inside ${rootPath}, not the root itself: ${absolutePath}`,
    );
  }

  if (relativePath.startsWith("..") || relativePath === "..") {
    throw new SyncError(
      `${description} must be inside ${rootPath}: ${absolutePath}`,
    );
  }

  return normalizeSyncRepoPath(relativePath);
};

export const buildConfiguredXdgLocalPath = (repoPath: string) => {
  return `$XDG_CONFIG_HOME/${repoPath}`;
};

export const tryNormalizeRepoPathInput = (value: string) => {
  try {
    return normalizeSyncRepoPath(value);
  } catch {
    return undefined;
  }
};
