import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncMachineListResult } from "#app/lib/output.js";
import { listSyncMachines } from "#app/services/machine.js";
import { createSyncContext } from "#app/services/runtime.js";

export default class SyncMachineList extends BaseCommand {
  public static override summary = "Show configured and active sync machines";

  public static override description =
    "List the machine names referenced by the current sync configuration and show which machine is active through ~/.config/devsync/settings.json.";

  public override async run(): Promise<void> {
    this.print(
      formatSyncMachineListResult(await listSyncMachines(createSyncContext())),
    );
  }
}
