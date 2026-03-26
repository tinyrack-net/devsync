import { buildCommand } from "@stricli/core";

import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/cli/common.js";
import { formatSyncPushResult } from "#app/lib/output.js";
import { pushSync } from "#app/services/push.js";

type PushFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
};

const pushCommand = buildCommand<PushFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Mirror local config into the git-backed sync repository",
    fullDescription:
      "Collect the current state of tracked local files and directories, then update the sync repository artifacts to match. Secret targets are encrypted before they are written into the repository.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const output = formatSyncPushResult(
      await pushSync(
        {
          dryRun: flags.dryRun ?? false,
          profile: flags.profile,
        },
        process.env,
        createProgressReporter(verbose),
      ),
      { verbose },
    );

    print(output);
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview repository updates only",
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

export default pushCommand;
