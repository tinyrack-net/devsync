import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { pullChanges } from "#app/services/pull.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type PullFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
};

const pullCommand = buildCommand<PullFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Apply the git-backed sync repository to local config paths",
    fullDescription:
      "Read tracked artifacts from the sync repository and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.",
  },
  async func(flags) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;

    const result = await pullChanges(
      { dryRun: flags.dryRun ?? false, profile: flags.profile },
      reporter,
    );

    const stats = `${result.plainFileCount} plain · ${result.decryptedFileCount} decrypted · ${result.symlinkCount} symlinks · ${result.directoryCount} dirs`;

    if (result.dryRun) {
      logger.info(`Pull preview ${pc.dim("(dry run)")}`);
    } else {
      logger.success("Pull complete");
    }

    logger.log(`  ${stats}`);
    logger.log(
      `  ${result.deletedLocalCount} local paths ${result.dryRun ? "would be removed" : "removed"}`,
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
      verbose: verboseFlag,
    },
  },
});

export default pullCommand;
