import { buildCommand } from "@stricli/core";
import { formatSyncProfileListResult } from "#app/lib/output.js";
import { listSyncProfiles } from "#app/services/profile.js";
import {
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.js";

type ProfileListFlags = {
  verbose?: boolean;
};

const profileListCommand = buildCommand<
  ProfileListFlags,
  [],
  DevsyncCliContext
>({
  docs: {
    brief: "Show configured and active sync profiles",
    fullDescription:
      "List the profile names referenced by the current sync configuration and show which profile is active through ~/.config/devsync/settings.json.",
  },
  async func(flags) {
    print(
      formatSyncProfileListResult(await listSyncProfiles(process.env), {
        verbose: isVerbose(flags.verbose),
      }),
    );
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
  },
});

export default profileListCommand;
