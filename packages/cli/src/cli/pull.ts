import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { DotweaveError } from "#app/lib/error.ts";
import { ask } from "#app/lib/prompt.ts";
import { applyPullPlan, preparePull } from "#app/services/pull.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { profileFlag, verboseFlag } from "./shared-flags.ts";

type PullFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
  yes?: boolean;
};

const logPullPlanChanges = (
  logger: ReturnType<typeof createCliLogger>,
  updatedLocalPaths: readonly string[],
  deletedLocalPaths: readonly string[],
) => {
  if (updatedLocalPaths.length > 0) {
    logger.section(`Update from repository (${updatedLocalPaths.length})`);
    logger.list(updatedLocalPaths as string[], { bullet: "+" });
  }

  if (deletedLocalPaths.length > 0) {
    logger.section(`Remove locally (${deletedLocalPaths.length})`);
    logger.list(deletedLocalPaths as string[], { bullet: "-" });
  }
};

const pullCommand = buildCommand<PullFlags, [], ApplicationContext>({
  docs: {
    brief: "Apply the git-backed sync directory to local config paths",
    fullDescription:
      "Read tracked artifacts from the sync directory and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.",
  },
  async func(flags) {
    const dryRun = flags.dryRun ?? false;
    const logger = createCliLogger({ verbose: flags.verbose ?? false });

    const spin = logger.spinner("Preparing pull...");
    const prepared = await preparePull({ dryRun, profile: flags.profile });
    const { config, plan } = prepared;
    spin.stop();

    if (
      plan.updatedLocalPaths.length === 0 &&
      plan.deletedLocalPaths.length === 0
    ) {
      logger.info("Already up to date");
      return;
    }

    logger.info("Planned pull changes");
    logPullPlanChanges(logger, plan.updatedLocalPaths, plan.deletedLocalPaths);

    if (dryRun) {
      logger.info("Pull preview (dry run)");
    } else if (flags.yes ?? false) {
      const applySpin = logger.spinner("Applying pull...");
      await applyPullPlan(config, plan);
      applySpin.succeed("Pull complete");
    } else {
      if (!(process.stdin.isTTY ?? false)) {
        throw new DotweaveError(
          "Pull confirmation requires an interactive terminal.",
          {
            hint: "Re-run 'dotweave pull -y' to apply changes without a prompt.",
          },
        );
      }

      const answer = await ask("Apply these changes? [y/N] ");

      if (answer.trim() !== "y") {
        logger.info("Skipped pull changes");
        return;
      }

      const applySpin = logger.spinner("Applying pull...");
      await applyPullPlan(config, plan);
      applySpin.succeed("Pull complete");
    }

    const updateAction = dryRun ? "would be updated" : "updated";
    const removeAction = dryRun ? "would be removed" : "removed";

    logger.kv(
      "updated",
      `${plan.updatedLocalPaths.length} paths ${updateAction}`,
    );
    logger.kv(
      "removed",
      `${plan.deletedLocalPaths.length} paths ${removeAction}`,
    );
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview local file updates only",
        kind: "boolean",
        optional: true,
      },
      profile: profileFlag,
      verbose: verboseFlag,
      yes: {
        brief: "Apply pull changes without prompting",
        kind: "boolean",
        optional: true,
        withNegated: false,
      },
    },
    aliases: {
      y: "yes",
    },
  },
});

export default pullCommand;
