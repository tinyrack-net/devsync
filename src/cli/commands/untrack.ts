import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncForgetResult } from "#app/lib/output.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { untrackSyncTarget } from "#app/services/untrack.ts";

export default class SyncUntrack extends BaseCommand {
  public static override summary = "Remove a tracked root from the sync config";

  public static override description =
    "Remove a tracked root from devsync configuration and delete its stored repository artifacts.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
  ];

  public static override args = {
    target: Args.string({
      description: "Tracked local root path or exact repository path to remove",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncUntrack);
    const output = formatSyncForgetResult(
      await untrackSyncTarget(
        {
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
