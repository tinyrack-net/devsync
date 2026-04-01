import { buildCommand } from "@stricli/core";
import {
  clearActiveProfile,
  type ProfileUpdateResult,
  setActiveProfile,
} from "#app/services/profile.ts";
import {
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";

type ProfileUseFlags = {
  verbose?: boolean;
};

const formatProfileUseOutput = (
  result: ProfileUpdateResult,
  verbose = false,
) => {
  return output(
    result.action === "use"
      ? `Active profile set to ${result.activeProfile}`
      : "Active profile cleared",
    result.warning,
    verbose && `sync dir: ${result.syncDirectory}`,
    verbose && `config: ${result.globalConfigPath}`,
  );
};

const profileUseCommand = buildCommand<
  ProfileUseFlags,
  [string?],
  DevsyncCliContext
>({
  docs: {
    brief: "Set or clear the active sync profile",
    fullDescription:
      "Write ~/.config/devsync/settings.json so plain push, pull, status, and doctor commands use the selected profile layer by default. Omit the profile name to clear the active profile.",
  },
  async func(flags, profile) {
    const verbose = isVerbose(flags.verbose);
    const result =
      profile !== undefined
        ? await setActiveProfile(profile)
        : await clearActiveProfile();

    print(formatProfileUseOutput(result, verbose));
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Profile name to activate (omit to clear)",
          optional: true,
          parse: String,
          placeholder: "profile",
        },
      ],
    },
  },
});

export default profileUseCommand;
