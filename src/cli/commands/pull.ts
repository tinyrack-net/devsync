import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncPullResult } from "#app/lib/output.ts";
import { pullSync } from "#app/services/pull.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncPull extends BaseCommand {
  public static override summary =
    "Apply the git-backed sync repository to local config paths";

  public static override description =
    "Read tracked artifacts from the sync repository and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --dry-run",
    "<%= config.bin %> <%= command.id %> --machine work",
  ];

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      summary: "Preview local file updates only",
      description:
        "Show which local files and directories devsync would create, update, or remove without touching the working machine state.",
    }),
    machine: Flags.string({
      summary: "Use a specific machine layer for this command",
      description:
        "Override the persisted active machine for this pull operation only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncPull);
    const output = formatSyncPullResult(
      await pullSync(
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
