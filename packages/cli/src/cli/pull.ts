import { buildCommand } from "@stricli/core";
import { formatSyncPullResult } from "#app/lib/output.ts";
import { pullSync } from "#app/services/pull.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";

type PullFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
};

const pullCommand = buildCommand<PullFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Apply the git-backed sync repository to local config paths",
    fullDescription:
      "Read tracked artifacts from the sync repository and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const output = formatSyncPullResult(
      await pullSync(
        {
          dryRun: flags.dryRun ?? false,
          profile: flags.profile,
        },
        createProgressReporter(verbose),
      ),
      { verbose },
    );

    print(output);
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview local file updates only",
        kind: "boolean",
        optional: true,
      },
      profile: {
        brief: "Use a specific profile layer for this command",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "profile",
      },
      verbose: verboseFlag,
    },
  },
});

export default pullCommand;
