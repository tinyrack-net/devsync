import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineUpdateResult } from "#app/lib/output.ts";
import { useSyncMachine } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineUse extends BaseCommand {
  public static override summary = "Activate a single sync machine";

  public static override description =
    "Write ~/.config/devsync/settings.json so plain push, pull, status, list, and doctor commands use the selected machine layer by default.";

  public static override args = {
    machine: Args.string({
      description: "Machine name to activate",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncMachineUse);
    this.print(
      formatSyncMachineUpdateResult(
        await useSyncMachine(args.machine, createSyncContext()),
      ),
    );
  }
}
