import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncPushResult } from "#app/lib/output.js";
import { pushSync } from "#app/services/push.js";
import { createSyncContext } from "#app/services/runtime.js";

export default class SyncPush extends BaseCommand {
  public static override summary =
    "Mirror local config into the git-backed sync repository";

  public static override description =
    "Collect the current state of tracked local files and directories, then update the sync repository artifacts to match. Secret targets are encrypted before they are written into the repository.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --dry-run",
    "<%= config.bin %> <%= command.id %> --machine work",
  ];

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      summary: "Preview repository updates only",
      description:
        "Show which repository files devsync would create, update, or remove without writing any changes into the sync repository.",
    }),
    machine: Flags.string({
      summary: "Use a specific machine layer for this command",
      description:
        "Override the persisted active machine for this push operation only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncPush);
    const output = formatSyncPushResult(
      await pushSync(
        {
          dryRun: flags["dry-run"],
          machine: flags.machine,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
