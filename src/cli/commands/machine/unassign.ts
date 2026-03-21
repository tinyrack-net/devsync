import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineUnassignResult } from "#app/lib/output.ts";
import { unassignSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineUnassign extends BaseCommand {
  public static override summary = "Remove machines from a tracked path";

  public static override description =
    "Remove specific machines from the assignment list for a tracked file entry or a child path inside a tracked directory. If all machines are removed, the assignment is deleted entirely.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig work",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh work --path secrets.zsh",
  ];

  public static override strict = false;

  public static override args = {
    target: Args.string({
      description: "Tracked entry (local path or repository path)",
      required: true,
    }),
  };

  public static override flags = {
    path: Flags.string({
      description:
        "Child path within a directory entry to unassign machines from",
      summary: "Child path for directory entries",
    }),
  };

  public override async run(): Promise<void> {
    const { argv, args, flags } = await this.parse(SyncMachineUnassign);
    const machines = (argv as string[]).slice(1);

    this.print(
      formatSyncMachineUnassignResult(
        await unassignSyncMachines(
          {
            machines,
            path: flags.path,
            target: args.target,
          },
          createSyncContext(),
        ),
      ),
    );
  }
}
