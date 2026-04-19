import { buildCommand } from "@stricli/core";
import consola from "consola";
import pc from "picocolors";
import { DotweaveError } from "#app/lib/error.ts";
import {
  applyPullPlan,
  buildPullResultFromPlan,
  preparePull,
} from "#app/services/pull.ts";
import {
  type DotweaveCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type PullFlags = {
  dryRun?: boolean;
  profile?: string;
  yes?: boolean;
  verbose?: boolean;
};

const logPullPlanChanges = (
  logger: ReturnType<typeof createCliLogger>,
  updatedLocalPaths: readonly string[],
  deletedLocalPaths: readonly string[],
) => {
  logger.info("Planned pull changes");

  if (updatedLocalPaths.length > 0) {
    logger.log(
      `  ${pc.bold("Update from repository")} (${updatedLocalPaths.length})`,
    );

    for (const path of updatedLocalPaths) {
      logger.log(pc.dim(`    + ${path}`));
    }
  }

  if (deletedLocalPaths.length > 0) {
    logger.log(`  ${pc.bold("Remove locally")} (${deletedLocalPaths.length})`);

    for (const path of deletedLocalPaths) {
      logger.log(pc.dim(`    - ${path}`));
    }
  }
};

const pullCommand = buildCommand<PullFlags, [], DotweaveCliContext>({
  docs: {
    brief: "Apply the git-backed sync directory to local config paths",
    fullDescription:
      "Read tracked artifacts from the sync directory and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.",
  },
  async func(flags) {
    const verbose = flags.verbose ?? false;
    const dryRun = flags.dryRun ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;
    const prepared = await preparePull(
      { dryRun, profile: flags.profile },
      reporter,
    );
    const { config, plan, syncDirectory } = prepared;

    if (
      plan.updatedLocalPaths.length === 0 &&
      plan.deletedLocalPaths.length === 0
    ) {
      logger.info("Already up to date");

      if (verbose) {
        logger.log(pc.dim(`  sync dir  ${syncDirectory}`));
        logger.log(
          pc.dim(
            `  config    ${buildPullResultFromPlan(plan, syncDirectory, dryRun).configPath}`,
          ),
        );
      }

      return;
    }

    logPullPlanChanges(logger, plan.updatedLocalPaths, plan.deletedLocalPaths);

    if (dryRun) {
      logger.info(`Pull preview ${pc.dim("(dry run)")}`);
    } else if (flags.yes ?? false) {
      await applyPullPlan(config, plan, reporter);
      logger.success("Pull complete");
    } else {
      if (!(process.stdin.isTTY ?? false)) {
        throw new DotweaveError(
          "Pull confirmation requires an interactive terminal.",
          {
            hint: "Re-run 'dotweave pull -y' to apply changes without a prompt.",
          },
        );
      }

      const answer = await consola.prompt("Apply these changes? [y/N] ", {
        cancel: "reject",
        type: "text",
      });

      if (answer.trim() !== "y") {
        logger.info("Skipped pull changes");
        return;
      }

      await applyPullPlan(config, plan, reporter);
      logger.success("Pull complete");
    }

    const result = buildPullResultFromPlan(plan, syncDirectory, dryRun);
    const updateAction = dryRun ? "would be updated" : "updated";
    const removeAction = dryRun ? "would be removed" : "removed";

    logger.log(
      `  ${plan.updatedLocalPaths.length} local paths ${updateAction}`,
    );
    logger.log(
      `  ${plan.deletedLocalPaths.length} local paths ${removeAction}`,
    );

    if (verbose) {
      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.configPath}`));
    }
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview local file updates only",
        kind: "boolean",
        optional: true,
      },
      profile: {
        brief: "Use a specific profile layer for this command",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "profile",
      },
      yes: {
        brief: "Apply pull changes without prompting",
        kind: "boolean",
        optional: true,
        withNegated: false,
      },
      verbose: verboseFlag,
    },
    aliases: {
      y: "yes",
    },
  },
});

export default pullCommand;
