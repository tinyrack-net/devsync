import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncAddResult } from "#app/lib/output.ts";
import { trackSyncTarget } from "#app/services/add.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncTrack extends BaseCommand {
  public static override summary =
    "Track local files or directories for syncing";

  public static override description =
    "Register one or more files or directories inside your home directory so devsync can mirror them into the sync repository. Targets may be absolute, home-relative, or relative to the current working directory as long as they resolve under HOME. Changes are recorded in the sync config only; use push to write artifacts to the repository.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig ~/.zshrc ~/.config/nvim",
    "<%= config.bin %> <%= command.id %> ~/.ssh/config --mode secret",
    "<%= config.bin %> <%= command.id %> ./.zshrc",
  ];

  public static override strict = false;

  public static override args = {
    targets: Args.string({
      description:
        "Local files or directories under your home directory to track, including cwd-relative paths",
      required: true,
    }),
  };

  public static override flags = {
    mode: Flags.string({
      default: "normal",
      options: ["normal", "secret", "ignore"],
      summary: "Sync mode for the tracked targets",
      description:
        "Set the initial sync mode. normal keeps plain files in sync, secret encrypts synced artifacts, and ignore skips the target during push and pull.",
    }),
  };

  public override async run(): Promise<void> {
    const { argv, flags } = await this.parse(SyncTrack);
    const targets = argv as string[];

    if (targets.length === 0) {
      this.error("At least one target path is required.");
    }

    const context = createSyncContext();
    const results: string[] = [];

    for (const target of targets) {
      const result = await trackSyncTarget(
        {
          mode: flags.mode as "normal" | "secret",
          target,
        },
        context,
      );
      results.push(formatSyncAddResult(result));
    }

    this.print(results.join("\n"));
  }
}
