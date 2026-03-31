import { buildCommand } from "@stricli/core";
import { formatProfileUpdateResult } from "#app/lib/output.ts";
import { clearActiveProfile, setActiveProfile } from "#app/services/profile.ts";
import {
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";

type ProfileUseFlags = {
  verbose?: boolean;
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
    const result =
      profile !== undefined
        ? await setActiveProfile(profile)
        : await clearActiveProfile();

    print(
      formatProfileUpdateResult(result, {
        verbose: isVerbose(flags.verbose),
      }),
    );
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
