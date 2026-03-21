import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncAddResult } from "#app/lib/output.ts";
import { trackSyncTarget } from "#app/services/add.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncTrack extends BaseCommand {
  public static override summary =
    "Track a local file or directory under your home directory";

  public static override description =
    "Register a root so devsync can mirror it into the sync repository. Targets may be absolute, home-relative, or relative to the current working directory as long as they resolve under HOME.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh --mode secret",
  ];

  public static override args = {
    target: Args.string({
      description:
        "Local file or directory under your home directory to track, including cwd-relative paths",
      required: true,
    }),
  };

  public static override flags = {
    mode: Flags.string({
      default: "normal",
      description:
        "Initial root mode. normal stores plain content and secret stores encrypted content.",
      options: ["normal", "secret"],
      summary: "Initial root mode",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncTrack);
    const output = formatSyncAddResult(
      await trackSyncTarget(
        {
          mode: flags.mode as "normal" | "secret",
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
