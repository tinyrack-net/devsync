import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { pushChanges } from "#app/services/push.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type PushFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
};

const pushCommand = buildCommand<PushFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Mirror local config into the git-backed sync directory",
    fullDescription:
      "Collect the current state of tracked local files and directories, then update the sync directory artifacts to match. Secret targets are encrypted before they are written into the repository.",
  },
  async func(flags) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;

    const result = await pushChanges(
      { dryRun: flags.dryRun ?? false, profile: flags.profile },
      reporter,
    );

    const stats = `${result.plainFileCount} plain · ${result.encryptedFileCount} encrypted · ${result.symlinkCount} symlinks · ${result.directoryCount} dirs`;

    if (result.dryRun) {
      logger.info(`Push preview ${pc.dim("(dry run)")}`);
    } else {
      logger.success("Push complete");
    }

    logger.log(`  ${stats}`);
    logger.log(
      `  ${result.deletedArtifactCount} stale artifacts ${result.dryRun ? "would be removed" : "removed"}`,
    );

    if (verbose) {
      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.configPath}`));
    }
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview repository updates only",
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

export default pushCommand;
