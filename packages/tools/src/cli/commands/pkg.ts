import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";
import {
  performPkgBuild,
  performPkgSmoke,
  type SeaCompressAlgorithm,
} from "../../lib/pkg.ts";

const COMPRESS_ALGORITHMS = new Set<string>(["Brotli", "GZip", "Zstd"]);

const parseCompress = (value: string): SeaCompressAlgorithm => {
  if (!COMPRESS_ALGORITHMS.has(value)) {
    throw new Error(
      `Invalid compress algorithm: ${value}. Must be one of: ${[...COMPRESS_ALGORITHMS].join(", ")}`,
    );
  }
  return value as SeaCompressAlgorithm;
};

const buildPkgCommand = buildCommand<
  { target?: string; compress?: SeaCompressAlgorithm },
  []
>({
  parameters: {
    flags: {
      target: {
        brief: "Target platform (e.g. node24-linux-x64)",
        kind: "parsed",
        parse: String,
        optional: true,
      },
      compress: {
        brief: "VFS compression algorithm (Brotli, GZip, Zstd)",
        kind: "parsed",
        parse: parseCompress,
        optional: true,
      },
    },
  },
  docs: {
    brief: "Build a single executable application using @yao-pkg/pkg SEA mode",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performPkgBuild({
      repoRoot,
      ...(flags.target !== undefined ? { target: flags.target } : {}),
      ...(flags.compress !== undefined ? { compress: flags.compress } : {}),
    });
  },
});

const smokePkgCommand = buildCommand<
  { skipBuild: boolean; executablePath?: string },
  []
>({
  parameters: {
    flags: {
      skipBuild: {
        brief: "Skip building the executable before running smoke tests",
        kind: "boolean",
        default: false,
      },
      executablePath: {
        brief: "Path to the executable to test (relative to repo root)",
        kind: "parsed",
        parse: String,
        optional: true,
      },
    },
  },
  docs: {
    brief: "Run smoke tests on the pkg executable",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performPkgSmoke({
      repoRoot,
      skipBuild: flags.skipBuild,
      ...(flags.executablePath !== undefined
        ? { executablePath: flags.executablePath }
        : {}),
    });
  },
});

export const pkgRoute = buildRouteMap({
  routes: {
    build: buildPkgCommand,
    smoke: smokePkgCommand,
  },
  docs: {
    brief: "Manage @yao-pkg/pkg SEA builds",
  },
});

export default pkgRoute;
