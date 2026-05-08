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
    logger.log(
      `  active: ${result.activeProfile ?? "none"} · available: ${result.availableProfiles.length === 0 ? "none" : result.availableProfiles.join(", ")}`,
    );
    logger.log(`  ${result.assignments.length} restricted entries`);

    if (result.activeProfile === undefined && result.assignments.length > 0) {
      logger.warn("  restricted entries are skipped until a profile is active");
    }
  },
  parameters: {
    flags: {},
  },
});

export default profileListCommand;
