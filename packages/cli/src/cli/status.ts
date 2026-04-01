import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { getStatus } from "#app/services/status.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type StatusFlags = {
  profile?: string;
  verbose?: boolean;
};

const statusCommand = buildCommand<StatusFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Show planned push and pull changes for the current sync config",
    fullDescription:
      "Compare the tracked local files with the sync repository and report what push would write to the repository and what pull would write back locally.",
  },
  async func(flags) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;

    const result = await getStatus({
      profile: flags.profile,
      reporter,
    });

    logger.info("Sync status");
    logger.log(
      `  profile: ${result.activeProfile ?? "none"} · ${result.entryCount} entries · ${result.recipientCount} recipients`,
    );
    logger.log(
      `  push  ${result.push.plainFileCount} plain · ${result.push.encryptedFileCount} encrypted · ${result.push.symlinkCount} symlinks · ${result.push.directoryCount} dirs · ${result.push.deletedArtifactCount} stale`,
    );
    logger.log(
      `  pull  ${result.pull.plainFileCount} plain · ${result.pull.decryptedFileCount} decrypted · ${result.pull.symlinkCount} symlinks · ${result.pull.directoryCount} dirs · ${result.pull.deletedLocalCount} remove`,
    );

    if (verbose) {
      if (result.push.preview.length > 0) {
        logger.log(pc.dim(`  push preview: ${result.push.preview.join(", ")}`));
      }
      if (result.pull.preview.length > 0) {
        logger.log(pc.dim(`  pull preview: ${result.pull.preview.join(", ")}`));
      }

      logger.log("  entries:");
      if (result.entries.length === 0) {
        logger.log(pc.dim("    none"));
      } else {
        for (const entry of result.entries) {
          const profiles =
            entry.profiles.length > 0
              ? `, profiles: ${entry.profiles.join(", ")}`
              : "";
          logger.log(
            pc.dim(
              `    ${entry.repoPath} → ${entry.localPath} (${entry.kind}, ${entry.mode}${profiles})`,
            ),
          );
        }
      }

      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.configPath}`));
    }
  },
  parameters: {
    flags: {
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

export default statusCommand;
