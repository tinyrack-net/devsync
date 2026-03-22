import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncMachineUpdateResult } from "#app/lib/output.js";
import { clearSyncMachines, useSyncMachine } from "#app/services/machine.js";
import { createSyncContext } from "#app/services/runtime.js";

export default class SyncMachineUse extends BaseCommand {
  public static override summary = "Set or clear the active sync machine";

  public static override description =
    "Write ~/.config/devsync/settings.json so plain push, pull, status, and doctor commands use the selected machine layer by default. Omit the machine name to clear the active machine.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> work",
    "<%= config.bin %> <%= command.id %>",
  ];

  public static override args = {
    machine: Args.string({
      description: "Machine name to activate (omit to clear)",
      required: false,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncMachineUse);
    const context = createSyncContext();
    const result =
      args.machine !== undefined
        ? await useSyncMachine(args.machine, context)
        : await clearSyncMachines(context);

    this.print(formatSyncMachineUpdateResult(result));
  }
}
