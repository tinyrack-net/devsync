import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncStatusResult } from "#app/lib/output.js";
import { createSyncContext } from "#app/services/runtime.js";
import { getSyncStatus } from "#app/services/status.js";

export default class SyncStatus extends BaseCommand {
  public static override summary =
    "Show planned push and pull changes for the current sync config";

  public static override description =
    "Compare the tracked local files with the sync repository and report what push would write to the repository and what pull would write back to your machine.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --machine work",
  ];

  public static override flags = {
    machine: Flags.string({
      summary: "Use a specific machine layer for this command",
      description:
        "Override the persisted active machine for this status command only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncStatus);
    const output = formatSyncStatusResult(
      await getSyncStatus(createSyncContext(), {
        machine: flags.machine,
      }),
    );

    this.print(output);
  }
}
