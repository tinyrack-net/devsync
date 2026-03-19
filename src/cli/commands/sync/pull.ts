import { Command, Flags } from "@oclif/core";

import {
  createSyncManager,
  runSyncPullCommand,
} from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

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
    const output = await runSyncPullCommand(
      {
        options: {
          dryRun: flags["dry-run"],
        },
      },
      {
        syncManager,
      },
    );

    process.stdout.write(output);
  }
}
