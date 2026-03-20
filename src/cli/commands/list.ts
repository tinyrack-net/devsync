import { Command } from "@oclif/core";

import { formatSyncListResult } from "#app/cli/sync-output.ts";
import { listSyncConfig } from "#app/services/list.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncList extends Command {
  public static override summary = "Show tracked sync entries and overrides";

  public override async run(): Promise<void> {
    const output = formatSyncListResult(
      await listSyncConfig(createSyncContext()),
    );

    process.stdout.write(output);
  }
}
