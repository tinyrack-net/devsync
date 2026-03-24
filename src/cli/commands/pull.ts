import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncPullResult } from "#app/lib/output.js";
import { pullSync } from "#app/services/pull.js";

export default class SyncPull extends BaseCommand {
  public static override summary =
    "Apply the git-backed sync repository to local config paths";

  public static override description =
    "Read tracked artifacts from the sync repository and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --dry-run",
    "<%= config.bin %> <%= command.id %> --profile work",
  ];

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      summary: "Preview local file updates only",
      description:
        "Show which local files and directories devsync would create, update, or remove without touching the local state.",
    }),
    profile: Flags.string({
      summary: "Use a specific profile layer for this command",
      description:
        "Override the persisted active profile for this pull operation only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncPull);
    const output = formatSyncPullResult(
      await pullSync(
        {
          dryRun: flags["dry-run"],
          profile: flags.profile,
        },
        process.env,
      ),
      { verbose: flags.verbose },
    );

    this.print(output);
  }
}
