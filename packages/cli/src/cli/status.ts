import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import {
  getStatus,
  type PullChanges,
  type PushChanges,
} from "#app/services/status.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { c, S } from "#app/services/terminal/theme.ts";
import { profileFlag, verboseFlag } from "./shared-flags.ts";

type StatusFlags = {
  profile?: string;
  verbose?: boolean;
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
    logger.log("  No push changes");
    return;
  }

  if (changes.added.length > 0) {
    logger.section(`Add (${changes.added.length})`);
    const displayItems = changes.added.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.added.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(`  ${c.action.add(S.add)} ${c.path(path)}`);
    }

    if (remainingCount > 0) {
      logger.log(c.dim(`  ... and ${remainingCount} more`));
    }
  }

  if (changes.modified.length > 0) {
    logger.section(`Modify (${changes.modified.length})`);
    const displayItems = changes.modified.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.modified.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(`  ${c.action.modify(S.modify)} ${c.path(path)}`);
    }

    if (remainingCount > 0) {
      logger.log(c.dim(`  ... and ${remainingCount} more`));
    }
  }

  if (changes.deleted.length > 0) {
    logger.section(`Delete (${changes.deleted.length})`);
    const displayItems = changes.deleted.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.deleted.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(`  ${c.action.delete(S.delete)} ${c.path(path)}`);
    }

    if (remainingCount > 0) {
      logger.log(c.dim(`  ... and ${remainingCount} more`));
    }
  }
};

const logPullChanges = (
  logger: ReturnType<typeof createCliLogger>,
  changes: PullChanges,
) => {
  const hasChanges = changes.updated.length > 0 || changes.deleted.length > 0;

  if (!hasChanges) {
    logger.log("  No pull changes");
    return;
  }

  if (changes.updated.length > 0) {
    logger.section(`Changed (${changes.updated.length})`);
    const displayItems = changes.updated.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.updated.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(`  ${c.action.add(S.add)} ${c.path(path)}`);
    }

    if (remainingCount > 0) {
      logger.log(c.dim(`  ... and ${remainingCount} more`));
    }
  }

  if (changes.deleted.length > 0) {
    logger.section(`Remove (${changes.deleted.length})`);
    const displayItems = changes.deleted.slice(0, MAX_DISPLAY_ITEMS);
    const remainingCount = changes.deleted.length - displayItems.length;

    for (const path of displayItems) {
      logger.log(`  ${c.action.delete(S.delete)} ${c.path(path)}`);
    }

    if (remainingCount > 0) {
      logger.log(c.dim(`  ... and ${remainingCount} more`));
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
    const logger = createCliLogger({ verbose: flags.verbose ?? false });

    const spin = logger.spinner("Checking sync status...");
    const result = await getStatus({
      profile: flags.profile,
    });
    spin.stop();

    logger.info(
      `Sync status — ${result.entryCount} entries, ${result.recipientCount} recipients, profile: ${result.activeProfile ?? "none"}`,
    );

    logger.section("Push changes (repository)");
    logPushChanges(logger, result.push.changes);

    logger.section("Pull changes (local)");
    logPullChanges(logger, result.pull.changes);
  },
  parameters: {
    flags: {
      profile: profileFlag,
      verbose: verboseFlag,
    },
  },
});

export default statusCommand;
