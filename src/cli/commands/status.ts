import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncStatusResult } from "#app/lib/output.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { getSyncStatus } from "#app/services/status.ts";

export default class SyncStatus extends BaseCommand {
  public static override summary =
    "Show planned push and pull changes for the current sync config";

  public override async run(): Promise<void> {
    const output = formatSyncStatusResult(
      await getSyncStatus(createSyncContext()),
    );

    this.print(output);
  }
}
