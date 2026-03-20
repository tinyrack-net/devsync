import { isAbsolute, relative, resolve } from "node:path";

import { normalizeSyncRepoPath } from "#app/config/sync.ts";
import { expandHomePath } from "#app/config/xdg.ts";

import { DevsyncError } from "./error.ts";

export const buildDirectoryKey = (repoPath: string) => {
  return `${repoPath}/`;
};

export const isPathEqualOrNested = (path: string, rootPath: string) => {
  const rootToPath = relative(rootPath, path);

  return (
    rootToPath === "" ||
    (!isAbsolute(rootToPath) &&
      !rootToPath.startsWith("..") &&
      rootToPath !== "..")
  );
};

export const doPathsOverlap = (leftPath: string, rightPath: string) => {
  return (
    isPathEqualOrNested(leftPath, rightPath) ||
    isPathEqualOrNested(rightPath, leftPath)
  );
};

export const isExplicitLocalPath = (target: string) => {
  return (
    target === "." ||
    target === ".." ||
    target === "~" ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith("~/") ||
    isAbsolute(target)
  );
};

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
