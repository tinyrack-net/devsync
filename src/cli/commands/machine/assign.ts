import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineAssignResult } from "#app/lib/output.ts";
import { assignSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineAssign extends BaseCommand {
  public static override summary = "Assign machines to a tracked path";

  public static override description =
    "Replace the machine list for a tracked file entry or a child path inside a tracked directory. Use --path for directory entries.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig default work",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh default work --path secrets.zsh",
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
      description: "Child path within a directory entry to assign machines to",
      summary: "Child path for directory entries",
    }),
  };

  public override async run(): Promise<void> {
    const { argv, flags } = await this.parse(SyncMachineAssign);
    const allArgs = argv as string[];
    const target = allArgs[0];
    const machines = allArgs.slice(1);

    if (!target) {
      this.error("A target path is required.");
    }

    if (machines.length === 0) {
      this.error("At least one machine name is required.");
    }

    this.print(
      formatSyncMachineAssignResult(
        await assignSyncMachines(
          {
            machines,
            path: flags.path,
            target,
          },
          createSyncContext(),
        ),
      ),
    );
  }
}
