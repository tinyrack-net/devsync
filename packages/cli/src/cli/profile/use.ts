import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { clearActiveProfile, setActiveProfile } from "#app/services/profile.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

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
      "Write ~/.config/devsync/settings.jsonc so plain push, pull, status, and doctor commands use the selected profile layer by default. Omit the profile name to clear the active profile.",
  },
  async func(flags, profile) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });

    const result =
      profile !== undefined
        ? await setActiveProfile(profile)
        : await clearActiveProfile();

    if (result.action === "use") {
      logger.success(`Active profile set to ${result.activeProfile}`);
    } else {
      logger.success("Active profile cleared");
    }

    if (result.warning) {
      logger.warn(`  ${result.warning}`);
    }

    if (verbose) {
      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.globalConfigPath}`));
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
