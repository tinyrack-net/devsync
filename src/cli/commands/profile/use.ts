import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncProfileUpdateResult } from "#app/lib/output.ts";
import { useSyncProfile } from "#app/services/profile.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncProfileUse extends BaseCommand {
  public static override summary = "Activate a single sync profile";

  public static override description =
    "Write ~/.config/devsync/config.json so only the selected profiled entries are active. Unprofiled entries stay active.";

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
    const { args } = await this.parse(SyncProfileUse);

    this.print(
      formatSyncProfileUpdateResult(
        await useSyncProfile(args.profile, createSyncContext()),
      ),
    );
  }
}
