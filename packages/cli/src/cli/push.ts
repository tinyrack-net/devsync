import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { pushChanges } from "#app/services/push.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { profileFlag } from "./shared-flags.ts";

type PushFlags = {
  dryRun?: boolean;
  profile?: string;
};

const pushCommand = buildCommand<PushFlags, [], ApplicationContext>({
  docs: {
    brief: "Mirror local config into the git-backed sync directory",
    fullDescription:
      "Collect the current state of tracked local files and directories, then update the sync directory artifacts to match. Secret targets are encrypted before they are written into the repository.",
  },
  async func(flags) {
    const logger = createCliLogger();

    const spin = logger.spinner("Pushing changes...");

    const result = await pushChanges({
      dryRun: flags.dryRun ?? false,
      profile: flags.profile,
    });

    if (result.dryRun) {
      spin.stop();
      logger.info("Push preview (dry run)");
    } else {
      spin.succeed("Push complete");
    }

    logger.kv("plain", String(result.plainFileCount));
    logger.kv("encrypted", String(result.encryptedFileCount));
    logger.kv("symlinks", String(result.symlinkCount));
    logger.kv("dirs", String(result.directoryCount));

    const removalAction = result.dryRun ? "would be removed" : "removed";
    logger.log(
      `  ${result.deletedArtifactCount} stale artifacts ${removalAction}`,
    );
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview repository updates only",
        kind: "boolean",
        optional: true,
      },
      profile: profileFlag,
    },
  },
});

export default pushCommand;
