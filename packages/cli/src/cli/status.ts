import { buildCommand } from "@stricli/core";
import { formatSyncStatusResult } from "#app/lib/output.ts";
import { getSyncStatus } from "#app/services/status.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";

type StatusFlags = {
  profile?: string;
  verbose?: boolean;
};

const statusCommand = buildCommand<StatusFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Show planned push and pull changes for the current sync config",
    fullDescription:
      "Compare the tracked local files with the sync repository and report what push would write to the repository and what pull would write back locally.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const output = formatSyncStatusResult(
      await getSyncStatus(process.env, {
        profile: flags.profile,
        reporter: createProgressReporter(verbose),
      }),
      { verbose },
    );

    print(output);
  },
  parameters: {
    flags: {
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

export default statusCommand;
