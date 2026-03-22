import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncForgetResult } from "#app/lib/output.js";
import { forgetSyncTarget } from "#app/services/forget.js";
import { createSyncContext } from "#app/services/runtime.js";

export default class SyncUntrack extends BaseCommand {
  public static override summary = "Stop tracking a synced path";

  public static override description =
    "Remove a tracked root entry or a nested override from devsync configuration. This only updates the sync config; actual file changes happen on the next push or pull. Use a local path to remove the main tracked target, or use a repository-relative child path inside a tracked directory to remove only that override.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "cd ~/mytool && <%= config.bin %> <%= command.id %> ./settings.json",
    "<%= config.bin %> <%= command.id %> .config/mytool",
  ];

  public static override args = {
    target: Args.string({
      description:
        "Tracked local path (including cwd-relative) or repository path to stop tracking",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncUntrack);
    const output = formatSyncForgetResult(
      await forgetSyncTarget(
        {
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
