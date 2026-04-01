import { buildCommand } from "@stricli/core";
import {
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";
import { type UntrackResult, untrackTarget } from "#app/services/untrack.ts";

type UntrackFlags = {
  verbose?: boolean;
};

const formatUntrackOutput = (result: UntrackResult, verbose = false) => {
  return output(
    `Stopped tracking ${result.repoPath}`,
    `artifacts: ${result.plainArtifactCount} plain, ${result.secretArtifactCount} secret`,
    verbose && `local: ${result.localPath}`,
    verbose && `sync dir: ${result.syncDirectory}`,
    verbose && `config: ${result.configPath}`,
  );
};

const untrackCommand = buildCommand<UntrackFlags, [string], DevsyncCliContext>({
  docs: {
    brief: "Stop tracking a synced path",
    fullDescription:
      "Remove a tracked root entry or a nested override from devsync configuration. This only updates the sync config; actual file changes happen on the next push or pull. Use a local path to remove the main tracked target, or use a repository-relative child path inside a tracked directory to remove only that override.",
  },
  async func(flags, target) {
    const verbose = isVerbose(flags.verbose);
    const result = await untrackTarget(
      {
        target,
      },
      process.cwd(),
    );

    print(formatUntrackOutput(result, verbose));
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
