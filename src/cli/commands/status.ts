import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncStatusResult } from "#app/lib/output.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { getSyncStatus } from "#app/services/status.ts";

export default class SyncStatus extends BaseCommand {
  public static override summary =
    "Show planned push and pull changes for the current sync config";

  public static override description =
    "Compare the tracked local files with the sync repository and report what push would write to the repository and what pull would write back to your machine.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    const output = formatSyncStatusResult(
      await getSyncStatus(createSyncContext()),
    );

    this.print(output);
  }
}
