import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import pc from "picocolors";
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

    const result = await pushChanges({
      dryRun: flags.dryRun ?? false,
      profile: flags.profile,
    });

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
