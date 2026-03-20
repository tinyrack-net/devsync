import { Command, Flags } from "@oclif/core";

import { formatSyncPullResult } from "#app/cli/sync-output.ts";
import { pullSync } from "#app/services/pull.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncPull extends Command {
  public static override summary =
    "Apply the git-backed sync repository to local config paths";

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      description: "Preview local config changes without writing files",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncPull);
    const output = formatSyncPullResult(
      await pullSync(
        {
          dryRun: flags["dry-run"],
        },
        createSyncContext(),
      ),
    );

    process.stdout.write(output);
  }
}
