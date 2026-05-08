import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { listProfiles } from "#app/services/profile.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type ProfileListFlags = Record<string, never>;

const profileListCommand = buildCommand<
  ProfileListFlags,
  [],
  ApplicationContext
>({
  docs: {
    brief: "Show configured and active sync profiles",
    fullDescription:
      "List the profile names referenced by the current sync configuration and show which profile is active through ~/.config/dotweave/settings.jsonc.",
  },
  async func() {
    const logger = createCliLogger();

    const result = await listProfiles();

    logger.info("Profiles");

    const profiles = [...result.availableProfiles];
    if (profiles.length === 0) {
      logger.log("  none");
    } else {
      logger.list(
        profiles.map((name) =>
          name === result.activeProfile ? `${name} (active)` : name,
        ),
        { highlightLast: false },
      );
    }

    if (result.assignments.length > 0) {
      logger.log(`  ${result.assignments.length} restricted entries`);
      if (result.activeProfile === undefined) {
        logger.warn("restricted entries are skipped until a profile is active");
      }
    }
  },
  parameters: {
    flags: {},
  },
});

export default profileListCommand;
