import { Args, Command } from "@oclif/core";

import { formatSyncForgetResult } from "#app/cli/sync-output.ts";
import { createSyncManager } from "#app/services/sync-manager.ts";

export default class SyncForget extends Command {
  public static override summary =
    "Remove a tracked local path or repository path from sync config.json";

  public static override args = {
    target: Args.string({
      description:
        "Tracked local path (including cwd-relative) or repository path to forget",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncForget);
    const syncManager = createSyncManager();
    const output = formatSyncForgetResult(
      await syncManager.forget({
        target: args.target,
      }),
    );

    process.stdout.write(output);
  }
}
