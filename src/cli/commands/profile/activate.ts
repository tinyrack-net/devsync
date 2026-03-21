import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncProfileUpdateResult } from "#app/lib/output.ts";
import { activateSyncProfile } from "#app/services/profile.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncProfileActivate extends BaseCommand {
  public static override summary = "Activate a profile if none is selected";

  public static override description =
    "Write ~/.config/devsync/config.json so the selected profile becomes active when no other profile is currently selected.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> work",
  ];

  public static override args = {
    profile: Args.string({
      description: "Profile name to activate",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncProfileActivate);

    this.print(
      formatSyncProfileUpdateResult(
        await activateSyncProfile(args.profile, createSyncContext()),
      ),
    );
  }
}
