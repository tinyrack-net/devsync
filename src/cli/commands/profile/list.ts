import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncProfileListResult } from "#app/lib/output.js";
import { listSyncProfiles } from "#app/services/profile.js";

export default class SyncProfileList extends BaseCommand {
  public static override summary = "Show configured and active sync profiles";

  public static override description =
    "List the profile names referenced by the current sync configuration and show which profile is active through ~/.config/devsync/settings.json.";

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncProfileList);

    this.print(
      formatSyncProfileListResult(await listSyncProfiles(process.env), {
        verbose: flags.verbose,
      }),
    );
  }
}
