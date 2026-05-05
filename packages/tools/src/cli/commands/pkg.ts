import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";
import { performPkgBuild, performPkgSmoke } from "../../lib/pkg.ts";

const buildPkgCommand = buildCommand<{ target?: string }, []>({
  parameters: {
    flags: {
      target: {
        brief: "Target platform (e.g. node24-linux-x64)",
        kind: "parsed",
        parse: String,
        optional: true,
      },
    },
  },
  docs: {
    brief: "Build a single executable application using @yao-pkg/pkg",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performPkgBuild({
      repoRoot,
      ...(flags.target !== undefined ? { target: flags.target } : {}),
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
    brief: "Manage @yao-pkg/pkg builds",
  },
});

export default pkgRoute;
