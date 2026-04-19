import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import {
  type DotweaveCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { untrackTarget } from "#app/services/untrack.ts";

type UntrackFlags = {
  verbose?: boolean;
};

const untrackCommand = buildCommand<UntrackFlags, [string], DotweaveCliContext>({
  docs: {
    brief: "Stop tracking a synced path",
    fullDescription:
      "Remove a tracked root entry or a nested override from dotweave configuration. This only updates the sync config; actual file changes happen on the next push or pull. Use a local path to remove the main tracked target, or use a repository-relative child path inside a tracked directory to remove only that override.",
  },
  async func(flags, target) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });

    const result = await untrackTarget({ target }, process.cwd());

    logger.success(`Stopped tracking ${result.repoPath}`);
    logger.log(
      `  ${result.plainArtifactCount} plain · ${result.secretArtifactCount} secret artifacts`,
    );

    if (verbose) {
      logger.log(pc.dim(`  local     ${result.localPath}`));
      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.configPath}`));
    }
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief:
            "Tracked local path (including cwd-relative) or repository path to stop tracking",
          parse: String,
          placeholder: "target",
        },
      ],
    },
  },
});

export default untrackCommand;
