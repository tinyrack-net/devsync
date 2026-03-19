import { Args, Command, Flags } from "@oclif/core";

import { formatSyncAddResult } from "#app/cli/sync-output.ts";
import { createSyncManager } from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

export default class SyncAdd extends Command {
  public static override summary =
    "Add a local file or directory under your home directory to sync config.json";

  public static override args = {
    target: Args.string({
      description: "Local file or directory under your home directory to track",
      required: true,
    }),
  };

  public static override flags = {
    secret: Flags.boolean({
      default: false,
      description: "Mark the added target as secret in sync config.json",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncAdd);
    const output = formatSyncAddResult(
      await syncManager.add({
        secret: flags.secret,
        target: args.target,
      }),
    );

    process.stdout.write(output);
  }
}
