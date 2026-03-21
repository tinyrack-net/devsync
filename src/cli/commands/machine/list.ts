import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineListResult } from "#app/lib/output.ts";
import { listSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncMachineList extends BaseCommand {
  public static override summary = "Show configured and active sync machines";

  public static override description =
    "List the machine names referenced by the current sync configuration and show which machine is active through ~/.config/devsync/config.json.";

  public override async run(): Promise<void> {
    this.print(
      formatSyncMachineListResult(await listSyncMachines(createSyncContext())),
    );
  }
}
