import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncProfileUpdateResult } from "#app/lib/output.ts";
import { clearSyncProfiles } from "#app/services/profile.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncProfileClear extends BaseCommand {
  public static override summary = "Disable all profiled entries";

  public static override description =
    "Write ~/.config/devsync/config.json without an activeProfile value so only unprofiled entries remain active.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    this.print(
      formatSyncProfileUpdateResult(
        await clearSyncProfiles(createSyncContext()),
      ),
    );
  }
}
