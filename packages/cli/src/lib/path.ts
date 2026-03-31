import { isAbsolute, relative } from "node:path";

/**
 * @description
 * Normalizes repository directory paths into a stable keyed form.
 */
export const buildDirectoryKey = (repoPath: string) => {
  return `${repoPath}/`;
};

/**
 * @description
 * Checks whether a path is the same as or contained within a root path.
 */
export const isPathEqualOrNested = (path: string, rootPath: string) => {
  const rootToPath = relative(rootPath, path);

  return (
    rootToPath === "" ||
    (!isAbsolute(rootToPath) &&
      !rootToPath.startsWith("..") &&
      rootToPath !== "..")
  );
};

/**
 * @description
 * Detects whether two paths cover any shared directory scope.
 */
export const doPathsOverlap = (leftPath: string, rightPath: string) => {
  return (
    isPathEqualOrNested(leftPath, rightPath) ||
    isPathEqualOrNested(rightPath, leftPath)
  );
};

/**
 * @description
 * Identifies path inputs that should be treated as explicit local filesystem targets.
 */
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
