import { dirname, isAbsolute, relative, resolve } from "node:path";

const homePrefix = "~";
const posixPathSeparator = "/";

export const homeSymbol = homePrefix;
export const pathSeparator = posixPathSeparator;

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
  const homePathPrefix = `${homePrefix}${posixPathSeparator}`;

  return (
    target === "." ||
    target === ".." ||
    target === homePrefix ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.startsWith(homePathPrefix) ||
    isAbsolute(target)
  );
};

export const normalizeLinkTarget = (target: string, baseDir?: string) => {
  const absoluteTarget =
    baseDir !== undefined && !isAbsolute(target)
      ? resolve(baseDir, target)
      : target;

  if (process.platform !== "win32") {
    return absoluteTarget;
  }

  const normalizeSlashes = (p: string) => p.replaceAll("\\", "/").toLowerCase();

  const resolveIfWindowsRootRelative = (p: string) => {
    if (p.startsWith("\\") && !p.startsWith("\\\\")) {
      return resolve(p);
    }
    return p;
  };

  try {
    return normalizeSlashes(
      require("node:fs").realpathSync.native(absoluteTarget),
    );
  } catch {
    if (baseDir !== undefined) {
      try {
        const dir = dirname(absoluteTarget);
        const base = require("node:path").basename(absoluteTarget);
        return normalizeSlashes(
          require("node:path").join(
            require("node:fs").realpathSync.native(dir),
            base,
          ),
        );
      } catch {
        return normalizeSlashes(resolveIfWindowsRootRelative(absoluteTarget));
      }
    }

    return normalizeSlashes(resolveIfWindowsRootRelative(absoluteTarget));
  }
};
