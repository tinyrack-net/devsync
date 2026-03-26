import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";

export default class SyncProfileUse extends BaseCommand {
  public static override summary = "Set or clear the active sync profile";

  public static override description =
    "Write ~/.config/devsync/settings.json so plain push, pull, status, and doctor commands use the selected profile layer by default. Omit the profile name to clear the active profile.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> work",
    "<%= config.bin %> <%= command.id %>",
  ];

  public static override args = {
    profile: Args.string({
      description: "Profile name to activate (omit to clear)",
      required: false,
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncProfileUse);
    const [
      { formatSyncProfileUpdateResult },
      { clearSyncProfiles, useSyncProfile },
    ] = await Promise.all([
      import("#app/lib/output.js"),
      import("#app/services/profile.js"),
    ]);
    const result =
      args.profile !== undefined
        ? await useSyncProfile(args.profile, process.env)
        : await clearSyncProfiles(process.env);

    this.print(
      formatSyncProfileUpdateResult(result, { verbose: flags.verbose }),
    );
  }
}
