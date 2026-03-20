import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncListResult } from "#app/lib/output.ts";
import { listSyncConfig } from "#app/services/list.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncList extends BaseCommand {
  public static override summary = "Show tracked sync entries and overrides";

  public static override description =
    "Print the current devsync configuration, including tracked roots, their default modes, and any nested overrides such as ignored or secret child paths.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    const output = formatSyncListResult(
      await listSyncConfig(createSyncContext()),
    );

    this.print(output);
  }
}
