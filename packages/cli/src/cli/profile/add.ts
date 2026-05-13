import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import type { NoFlags } from "#app/cli/shared-flags.ts";
import { addProfile } from "#app/services/profile.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

const profileAddCommand = buildCommand<NoFlags, [string], ApplicationContext>({
  docs: {
    brief: "Add a sync profile",
    fullDescription:
      "Register a non-default profile in manifest.jsonc so entries can be assigned to it and it can be selected with profile use.",
  },
  async func(_flags, profile) {
    const logger = createCliLogger();
    const result = await addProfile(profile);

    logger.success(`Added profile ${result.profile}`);
  },
  parameters: {
    flags: {},
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Profile name to add",
          parse: String,
          placeholder: "profile",
        },
      ],
    },
  },
});

export default profileAddCommand;
