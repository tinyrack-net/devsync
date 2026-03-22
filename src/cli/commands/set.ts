import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncSetResult } from "#app/lib/output.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { setSyncTargetMode } from "#app/services/set.ts";

export default class SyncSet extends BaseCommand {
  public static override summary = "Set sync mode for a tracked path";

  public static override description =
    "Change how devsync treats an already tracked path. Use normal for plain tracked content, secret for encrypted artifacts, and ignore for files or directories that should stay out of sync. Targets can point at a tracked root or at a nested path inside a tracked directory.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig secret",
    "<%= config.bin %> <%= command.id %> ~/.config/mytool/token.json secret",
    "<%= config.bin %> <%= command.id %> ~/.config/mytool/cache ignore --recursive",
    "cd ~/.ssh && <%= config.bin %> <%= command.id %> known_hosts ignore",
    "<%= config.bin %> <%= command.id %> .config/mytool/public.json normal",
  ];

  public static override args = {
    target: Args.string({
      description:
        "Tracked local path (including cwd-relative) or repository path",
      required: true,
    }),
    state: Args.string({
      description:
        "Mode to apply. normal keeps plain files in sync, secret encrypts synced artifacts, and ignore skips the target during push and pull.",
      options: ["normal", "secret", "ignore"],
      required: true,
    }),
  };

  public static override flags = {
    recursive: Flags.boolean({
      default: false,
      summary: "Apply the mode to a directory subtree",
      description:
        "When the target is a directory, update the whole subtree. For tracked directory roots, this also changes the default mode used for descendants unless a child override exists.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncSet);
    const output = formatSyncSetResult(
      await setSyncTargetMode(
        {
          recursive: flags.recursive,
          state: args.state as "ignore" | "normal" | "secret",
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
