import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncProfileListResult } from "#app/lib/output.ts";
import { listSyncProfiles } from "#app/services/profile.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncProfileList extends BaseCommand {
  public static override summary = "Show configured and active sync profiles";

  public static override description =
    "List the profiles referenced by the current sync configuration and show which profiles are active through ~/.config/devsync/config.json.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    this.print(
      formatSyncProfileListResult(await listSyncProfiles(createSyncContext())),
    );
  }
}
