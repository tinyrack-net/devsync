import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineUnassignResult } from "#app/lib/output.ts";
import { unassignSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineUnassign extends BaseCommand {
  public static override summary = "Remove machines from a tracked entry";

  public static override description =
    "Remove specific machines from the assignment list for a tracked entry. If all machines are removed, the assignment is deleted entirely.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig work",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh/secrets.zsh work",
  ];

  public static override strict = false;

  public static override args = {
    target: Args.string({
      description: "Tracked entry (local path or repository path)",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { argv } = await this.parse(SyncMachineUnassign);
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
      formatSyncMachineUnassignResult(
        await unassignSyncMachines(
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
