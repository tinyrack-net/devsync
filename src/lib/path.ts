import { isAbsolute, relative } from "node:path";

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
