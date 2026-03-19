import { Command, Flags } from "@oclif/core";

import { formatSyncPushResult } from "#app/cli/sync-output.ts";
import { createSyncManager } from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

export default class SyncPush extends Command {
  public static override summary =
    "Mirror local config into the git-backed sync repository";

  public static override flags = {
    "dry-run": Flags.boolean({
      default: false,
      description: "Preview sync repository changes without writing files",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncPush);
    const output = formatSyncPushResult(
      await syncManager.push({
        dryRun: flags["dry-run"],
      }),
    );

    process.stdout.write(output);
  }
}
