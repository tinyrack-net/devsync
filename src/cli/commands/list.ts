import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncListResult } from "#app/lib/output.ts";
import { listSyncConfig } from "#app/services/list.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncList extends BaseCommand {
  public static override summary = "Show tracked sync entries and overrides";

  public override async run(): Promise<void> {
    const output = formatSyncListResult(
      await listSyncConfig(createSyncContext()),
    );

    this.print(output);
  }
}
