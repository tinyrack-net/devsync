import { buildCommand } from "@stricli/core";
import { listProfiles, type ProfileListResult } from "#app/services/profile.ts";
import {
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";

type ProfileListFlags = {
  verbose?: boolean;
};

const formatProfileListOutput = (
  result: ProfileListResult,
  verbose = false,
) => {
  return output(
    "Profiles",
    `active: ${result.activeProfile ?? "none"}`,
    `available: ${result.availableProfiles.length === 0 ? "none" : result.availableProfiles.join(", ")}`,
    `restricted entries: ${result.assignments.length}`,
    result.activeProfile === undefined &&
      result.assignments.length > 0 &&
      "warning: restricted entries are skipped until a profile is active",
    ...(verbose
      ? [
          "assignments:",
          ...(result.assignments.length === 0
            ? ["- none"]
            : result.assignments.map((assignment) => {
                return `- ${assignment.entryRepoPath} [${assignment.profiles.join(", ")}]`;
              })),
          `sync dir: ${result.syncDirectory}`,
          `config: ${result.globalConfigPath}`,
        ]
      : []),
  );
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
    const verbose = isVerbose(flags.verbose);
    const result = await listProfiles();

    print(formatProfileListOutput(result, verbose));
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
  },
});

export default profileListCommand;
