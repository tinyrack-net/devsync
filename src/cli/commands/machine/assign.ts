import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineAssignResult } from "#app/lib/output.ts";
import { assignSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineAssign extends BaseCommand {
  public static override summary = "Set or clear machines for a tracked entry";

  public static override description =
    "Replace the machine list for a tracked entry. Machines control which namespace stores the entry's artifacts in the sync repository. Omit machine names to clear all assignments.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig default work",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh/secrets.zsh default work",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
  ];

  public static override strict = false;

  public static override args = {
    target: Args.string({
      description: "Tracked entry (local path or repository path)",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { argv } = await this.parse(SyncMachineAssign);
    const allArgs = argv as string[];
    const target = allArgs[0];
    const machines = allArgs.slice(1);

    if (!target) {
      this.error("A target path is required.");
    }

    this.print(
      formatSyncMachineAssignResult(
        await assignSyncMachines(
          {
            machines,
            target,
          },
          createSyncContext(),
        ),
      ),
    );
  }
}
