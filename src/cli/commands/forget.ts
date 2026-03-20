import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncForgetResult } from "#app/lib/output.ts";
import { forgetSyncTarget } from "#app/services/forget.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncForget extends BaseCommand {
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

    this.print(output);
  }
}
