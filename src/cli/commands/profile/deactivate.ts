import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncProfileUpdateResult } from "#app/lib/output.ts";
import { deactivateSyncProfile } from "#app/services/profile.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncProfileDeactivate extends BaseCommand {
  public static override summary = "Clear the active profile if it matches";

  public static override description =
    "Write ~/.config/devsync/config.json so the selected profile is cleared when it is currently active.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> work",
  ];

  public static override args = {
    profile: Args.string({
      description: "Profile name to deactivate",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncProfileDeactivate);

    this.print(
      formatSyncProfileUpdateResult(
        await deactivateSyncProfile(args.profile, createSyncContext()),
      ),
    );
  }
}
