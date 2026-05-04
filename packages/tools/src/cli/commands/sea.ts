import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";
import { performSeaBuild, performSeaSmoke } from "../../lib/sea.ts";

const buildSeaCommand = buildCommand<{ bundleOnly: boolean }, []>({
  parameters: {
    flags: {
      bundleOnly: {
        kind: "boolean",
        brief: "Only bundle the CLI package without generating the executable",
        default: false,
      },
    },
  },
  docs: {
    brief: "Build a Single Executable Application (SEA) for the CLI",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performSeaBuild({
      repoRoot,
      bundleOnly: flags.bundleOnly,
    });
  },
});

const smokeSeaCommand = buildCommand<{ skipBuild: boolean }, []>({
  parameters: {
    flags: {
      skipBuild: {
        kind: "boolean",
        brief: "Skip building the SEA executable before running smoke tests",
        default: false,
      },
    },
  },
  docs: {
    brief: "Run smoke tests on the SEA executable",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performSeaSmoke({
      repoRoot,
      skipBuild: flags.skipBuild,
    });
  },
});

export const seaRoute = buildRouteMap({
  routes: {
    build: buildSeaCommand,
    smoke: smokeSeaCommand,
  },
  docs: {
    brief: "Manage Single Executable Application (SEA) builds",
  },
});

export default seaRoute;
