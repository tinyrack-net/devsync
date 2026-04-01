import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { listProfiles } from "#app/services/profile.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type ProfileListFlags = {
  verbose?: boolean;
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
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });

    const result = await listProfiles();

    logger.info("Profiles");
    logger.log(
      `  active: ${result.activeProfile ?? "none"} · available: ${result.availableProfiles.length === 0 ? "none" : result.availableProfiles.join(", ")}`,
    );
    logger.log(`  ${result.assignments.length} restricted entries`);

    if (result.activeProfile === undefined && result.assignments.length > 0) {
      logger.warn("  restricted entries are skipped until a profile is active");
    }

    if (verbose) {
      logger.log("  assignments:");
      if (result.assignments.length === 0) {
        logger.log(pc.dim("    none"));
      } else {
        for (const assignment of result.assignments) {
          logger.log(
            pc.dim(
              `    ${assignment.entryRepoPath} → [${assignment.profiles.join(", ")}]`,
            ),
          );
        }
      }

      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.globalConfigPath}`));
    }
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
  },
});

export default profileListCommand;
