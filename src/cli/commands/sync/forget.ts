import { Args, Command } from "@oclif/core";

import {
  createSyncManager,
  runSyncForgetCommand,
} from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

export default class SyncForget extends Command {
  public static override summary =
    "Remove a tracked config path from sync config.json";

  public static override args = {
    target: Args.string({
      description: "Tracked local path or repository path to forget",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncForget);
    const output = await runSyncForgetCommand(
      {
        target: args.target,
      },
      {
        syncManager,
      },
    );

    process.stdout.write(output);
  }
}
