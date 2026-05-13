import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import type { NoFlags } from "#app/cli/shared-flags.ts";
import { listProfiles } from "#app/services/profile.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

const profileListCommand = buildCommand<NoFlags, [], ApplicationContext>({
  docs: {
    brief: "Show configured and active sync profiles",
    fullDescription:
      "List the implicit default profile and manifest-registered profiles, and show which profile is active through ~/.config/dotweave/settings.jsonc.",
  },
  async func() {
    const logger = createCliLogger();

    const result = await listProfiles();

    logger.info("Profiles");

    const profiles = [...result.availableProfiles];
    logger.list(
      profiles.map((name) =>
        name === result.activeProfile ? `${name} (active)` : name,
      ),
      { highlightLast: false },
    );

    if (result.activeProfileWarning !== undefined) {
      logger.warn(result.activeProfileWarning);
    }
  },
  parameters: {
    flags: {},
  },
});

export default profileListCommand;
