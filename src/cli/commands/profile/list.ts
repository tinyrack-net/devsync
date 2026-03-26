import { BaseCommand } from "#app/cli/base-command.js";

export default class SyncProfileList extends BaseCommand {
  public static override summary = "Show configured and active sync profiles";

  public static override description =
    "List the profile names referenced by the current sync configuration and show which profile is active through ~/.config/devsync/settings.json.";

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncProfileList);
    const [{ formatSyncProfileListResult }, { listSyncProfiles }] =
      await Promise.all([
        import("#app/lib/output.js"),
        import("#app/services/profile.js"),
      ]);

    this.print(
      formatSyncProfileListResult(await listSyncProfiles(process.env), {
        verbose: flags.verbose,
      }),
    );
  }
}
