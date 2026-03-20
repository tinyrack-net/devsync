import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncAddResult } from "#app/lib/output.ts";
import { addSyncTarget } from "#app/services/add.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncAdd extends BaseCommand {
  public static override summary =
    "Add a local file or directory under your home directory to sync config.json";

  public static override args = {
    target: Args.string({
      description:
        "Local file or directory under your home directory to track, including cwd-relative paths",
      required: true,
    }),
  };

  public static override flags = {
    secret: Flags.boolean({
      default: false,
      description: "Set the added target mode to secret in sync config.json",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncAdd);
    const output = formatSyncAddResult(
      await addSyncTarget(
        {
          secret: flags.secret,
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
