import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineUpdateResult } from "#app/lib/output.ts";
import { clearSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineClear extends BaseCommand {
  public static override summary = "Clear the active sync machine";

  public static override description =
    "Write ~/.config/devsync/config.json without an activeMachine value so commands operate on the shared base layer unless --machine is passed explicitly.";

  public override async run(): Promise<void> {
    this.print(
      formatSyncMachineUpdateResult(
        await clearSyncMachines(createSyncContext()),
      ),
    );
  }
}
