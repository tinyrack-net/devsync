import { buildCommand } from "@stricli/core";
import { clearActiveProfile, setActiveProfile } from "#app/services/profile.ts";
import { type DotweaveCliContext } from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type ProfileUseFlags = Record<string, never>;

const profileUseCommand = buildCommand<
  ProfileUseFlags,
  [string?],
  DotweaveCliContext
>({
  docs: {
    brief: "Set or clear the active sync profile",
    fullDescription:
      "Write ~/.config/dotweave/settings.jsonc so plain push, pull, status, and doctor commands use the selected profile layer by default. Omit the profile name to clear the active profile.",
  },
  async func(_flags, profile) {
    const logger = createCliLogger();

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
  },
  parameters: {
    flags: {},
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
