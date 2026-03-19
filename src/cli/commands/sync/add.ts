import { Args, Command, Flags } from "@oclif/core";

import {
  createSyncManager,
  runSyncAddCommand,
} from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

export default class SyncAdd extends Command {
  public static override summary =
    "Add a local config path to sync config.json";

  public static override args = {
    target: Args.string({
      description: "Local config file or directory to track",
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
    const output = await runSyncAddCommand(
      {
        options: {
          secret: flags.secret,
        },
        target: args.target,
      },
      {
        syncManager,
      },
    );

    process.stdout.write(output);
  }
}
