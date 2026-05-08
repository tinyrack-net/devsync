import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import {
  getStatus,
  type PullChanges,
  type PushChanges,
} from "#app/services/status.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { profileFlag } from "./shared-flags.ts";

type StatusFlags = {
  profile?: string;
};

const MAX_DISPLAY_ITEMS = 10;

const logPushChanges = (
  logger: ReturnType<typeof createCliLogger>,
  changes: PushChanges,
) => {
  const hasChanges =
    changes.added.length > 0 ||
    changes.modified.length > 0 ||
    changes.deleted.length > 0;

  if (!hasChanges) {
    logger.log(`  ${pc.dim("No push changes")}`);
    return;
  }

  if (changes.added.length > 0) {
    logger.log(
      `    ${pc.green("+")} ${pc.bold("Add")} (${changes.added.length}):`,
    );
    const displayItems = changes.added.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.added.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(pc.dim(`        ${path}`));
    }

    if (remainingCount > 0) {
      logger.log(pc.dim(`        ... and ${remainingCount} more`));
    }
  }

  if (changes.modified.length > 0) {
    logger.log(
      `    ${pc.yellow("~")} ${pc.bold("Modify")} (${changes.modified.length}):`,
    );
    const displayItems = changes.modified.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.modified.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(pc.dim(`        ${path}`));
    }

    if (remainingCount > 0) {
      logger.log(pc.dim(`        ... and ${remainingCount} more`));
    }
  }

  if (changes.deleted.length > 0) {
    logger.log(
      `    ${pc.red("-")} ${pc.bold("Delete")} (${changes.deleted.length}):`,
    );
    const displayItems = changes.deleted.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.deleted.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(pc.dim(`        ${path}`));
    }

    if (remainingCount > 0) {
      logger.log(pc.dim(`        ... and ${remainingCount} more`));
    }
  }
};

const logPullChanges = (
  logger: ReturnType<typeof createCliLogger>,
  changes: PullChanges,
) => {
  const hasChanges = changes.updated.length > 0 || changes.deleted.length > 0;

  if (!hasChanges) {
    logger.log(`  ${pc.dim("No pull changes")}`);
    return;
  }

  if (changes.updated.length > 0) {
    logger.log(
      `    ${pc.green("+")} ${pc.bold("Changed")} (${changes.updated.length}):`,
    );
    const displayItems = changes.updated.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.updated.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(pc.dim(`        ${path}`));
    }

    if (remainingCount > 0) {
      logger.log(pc.dim(`        ... and ${remainingCount} more`));
    }
  }

  if (changes.deleted.length > 0) {
    logger.log(
      `    ${pc.red("-")} ${pc.bold("Remove")} (${changes.deleted.length}):`,
    );
    const displayItems = changes.deleted.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.deleted.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(pc.dim(`        ${path}`));
    }

    if (remainingCount > 0) {
      logger.log(pc.dim(`        ... and ${remainingCount} more`));
    }
  }
};

const statusCommand = buildCommand<StatusFlags, [], ApplicationContext>({
  docs: {
    brief: "Show planned push and pull changes for the current sync config",
    fullDescription:
      "Compare the tracked local files with the sync directory and report what push would write to the repository and what pull would write back locally.",
  },
  async func(flags) {
    const logger = createCliLogger();

    const result = await getStatus({
      profile: flags.profile,
    });

    logger.info("Sync status");
    logger.log(
      `  profile: ${result.activeProfile ?? "none"} · ${result.entryCount} entries · ${result.recipientCount} recipients`,
    );

    logger.log("");
    logger.log(`${pc.bold("Push changes")} ${pc.dim("(repository):")}`);
    logPushChanges(logger, result.push.changes);

    logger.log("");
    logger.log(`${pc.bold("Pull changes")} ${pc.dim("(local):")}`);
    logPullChanges(logger, result.pull.changes);
  },
  parameters: {
    flags: {
      profile: profileFlag,
    },
  },
});

export default statusCommand;
