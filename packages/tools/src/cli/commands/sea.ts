import { buildCommand, buildRouteMap } from "@stricli/core";
import { getRepoRoot } from "../../lib/git.ts";
import {
  performSeaBuild,
  performSeaSmoke,
  type SeaTarget,
} from "../../lib/sea.ts";

const VALID_TARGETS: SeaTarget[] = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
  "bun-windows-arm64",
];

const parseSeaTarget = (value: string): SeaTarget => {
  if ((VALID_TARGETS as string[]).includes(value)) {
    return value as SeaTarget;
  }

  throw new Error(
    `Invalid target "${value}". Valid targets: ${VALID_TARGETS.join(", ")}`,
  );
};

const buildSeaCommand = buildCommand<
  { bundleOnly: boolean; target?: SeaTarget },
  []
>({
  parameters: {
    flags: {
      bundleOnly: {
        kind: "boolean",
        brief: "Only bundle the CLI package without generating the executable",
        default: false,
      },
      target: {
        kind: "parsed",
        brief:
          "Cross-compile target (e.g. bun-linux-x64, bun-darwin-arm64, bun-windows-x64)",
        parse: parseSeaTarget,
        optional: true,
      },
    },
  },
  docs: {
    brief: "Build a standalone executable with bun build --compile",
  },
  async func(flags) {
    const repoRoot = await getRepoRoot(process.cwd());
    await performSeaBuild({
      repoRoot,
      bundleOnly: flags.bundleOnly,
      target: flags.target,
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
    brief: "Manage standalone executable builds",
  },
});

export default seaRoute;
