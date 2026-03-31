import { buildCommand } from "@stricli/core";
import { formatUntrackResult } from "#app/lib/output.ts";
import {
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { untrackTarget } from "#app/services/untrack.ts";

type UntrackFlags = {
  verbose?: boolean;
};

const untrackCommand = buildCommand<UntrackFlags, [string], DevsyncCliContext>({
  docs: {
    brief: "Stop tracking a synced path",
    fullDescription:
      "Remove a tracked root entry or a nested override from devsync configuration. This only updates the sync config; actual file changes happen on the next push or pull. Use a local path to remove the main tracked target, or use a repository-relative child path inside a tracked directory to remove only that override.",
  },
  async func(flags, target) {
    const output = formatUntrackResult(
      await untrackTarget(
        {
          target,
        },
        process.cwd(),
      ),
      { verbose: isVerbose(flags.verbose) },
    );

    print(output);
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
