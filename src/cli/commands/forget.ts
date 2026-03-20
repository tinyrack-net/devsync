import { Args, Command } from "@oclif/core";

import { formatSyncForgetResult } from "#app/cli/sync-output.ts";
import { forgetSyncTarget } from "#app/services/forget.ts";
import { createSyncContext } from "#app/services/runtime.ts";

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
    const output = formatSyncForgetResult(
      await forgetSyncTarget(
        {
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    process.stdout.write(output);
  }
}
