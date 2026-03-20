import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncPushResult } from "#app/lib/output.ts";
import { pushSync } from "#app/services/push.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncPush extends BaseCommand {
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
      await pushSync(
        {
          dryRun: flags["dry-run"],
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
