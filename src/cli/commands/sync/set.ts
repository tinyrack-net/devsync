import { Args, Command, Flags } from "@oclif/core";

import { formatSyncSetResult } from "#app/cli/sync-output.ts";
import { createSyncManager } from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

export default class SyncSet extends Command {
  public static override summary =
    "Set sync mode for a tracked directory root, child file, or child subtree";

  public static override args = {
    state: Args.string({
      description: "Mode to apply: normal, secret, or ignore",
      options: ["normal", "secret", "ignore"],
      required: true,
    }),
    target: Args.string({
      description:
        "Tracked local path (including cwd-relative) or repository path inside a tracked directory",
      required: true,
    }),
  };

  public static override flags = {
    recursive: Flags.boolean({
      default: false,
      description:
        "Apply the mode to a directory subtree or update a tracked directory root default",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncSet);
    const output = formatSyncSetResult(
      await syncManager.set({
        recursive: flags.recursive,
        state: args.state as "ignore" | "normal" | "secret",
        target: args.target,
      }),
    );

    process.stdout.write(output);
  }
}
