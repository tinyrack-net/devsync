import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncForgetResult } from "#app/lib/output.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { untrackSyncTarget } from "#app/services/untrack.ts";

export default class SyncUntrack extends BaseCommand {
  public static override summary = "Remove a tracked root from the sync config";

  public static override description =
    "Remove a shared or machine-specific tracked root from devsync configuration and delete its stored repository artifacts.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig-work --machine work",
  ];

  public static override args = {
    target: Args.string({
      description: "Tracked local root path or exact repository path to remove",
      required: true,
    }),
  };

  public static override flags = {
    machine: Flags.string({
      summary: "Untrack the root from a specific machine layer",
      description:
        "When omitted, the tracked root is removed from the shared base layer.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncUntrack);
    const output = formatSyncForgetResult(
      await untrackSyncTarget(
        {
          machine: flags.machine,
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
