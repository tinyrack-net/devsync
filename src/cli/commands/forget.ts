import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncForgetResult } from "#app/lib/output.ts";
import { forgetSyncTarget } from "#app/services/forget.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncForget extends BaseCommand {
  public static override summary =
    "Remove a tracked local path or repository path from sync config.json";

  public static override description =
    "Remove a tracked root entry or a nested override from devsync configuration. Use a local path to forget the main tracked target, or use a repository-relative child path inside a tracked directory to remove only that override.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "cd ~/mytool && <%= config.bin %> <%= command.id %> ./settings.json",
    "<%= config.bin %> <%= command.id %> .config/mytool",
  ];

  public static override args = {
    target: Args.string({
      description:
        "Tracked local path (including cwd-relative) or repository path to forget",
      required: true,
    }),
  };

  public static override flags = {
    profile: Flags.string({
      summary: "Forget a profile-specific child override",
      description:
        "Remove overrides from a named profile namespace for child paths inside a tracked directory.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncForget);
    const output = formatSyncForgetResult(
      await forgetSyncTarget(
        {
          profile: flags.profile,
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
