import { Command } from "@oclif/core";

import { formatSyncStatusResult } from "#app/cli/sync-output.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { getSyncStatus } from "#app/services/status.ts";

export default class SyncStatus extends Command {
  public static override summary =
    "Show planned push and pull changes for the current sync config";

  public override async run(): Promise<void> {
    const output = formatSyncStatusResult(
      await getSyncStatus(createSyncContext()),
    );

    process.stdout.write(output);
  }
}
