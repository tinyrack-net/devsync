import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import type { NoFlags } from "#app/cli/shared-flags.ts";
import { removeProfile } from "#app/services/profile.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

const profileRemoveCommand = buildCommand<
  NoFlags,
  [string],
  ApplicationContext
>({
  docs: {
    brief: "Remove a sync profile",
    fullDescription:
      "Unregister an unused non-default profile from manifest.jsonc. Reassign or clear tracked entry assignments before removing a referenced profile.",
  },
  async func(_flags, profile) {
    const logger = createCliLogger();
    const result = await removeProfile(profile);

    logger.success(`Removed profile ${result.profile}`);
  },
  parameters: {
    flags: {},
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Profile name to remove",
          parse: String,
          placeholder: "profile",
        },
      ],
    },
  },
});

export default profileRemoveCommand;
