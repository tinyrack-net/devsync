import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncAddResult } from "#app/lib/output.ts";
import { addSyncTarget } from "#app/services/add.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncAdd extends BaseCommand {
  public static override summary =
    "Add a local file or directory under your home directory to sync config.json";

  public static override description =
    "Register a file or directory inside your home directory so devsync can mirror it into the sync repository. Targets may be absolute, home-relative, or relative to the current working directory as long as they resolve under HOME.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ./.zshrc",
    "<%= config.bin %> <%= command.id %> ~/.config/mytool --secret",
  ];

  public static override args = {
    target: Args.string({
      description:
        "Local file or directory under your home directory to track, including cwd-relative paths",
      required: true,
    }),
  };

  public static override flags = {
    secret: Flags.boolean({
      default: false,
      summary: "Track the target as secret",
      description:
        "Mark the added file or directory as secret immediately so push stores encrypted artifacts instead of plain tracked files.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncAdd);
    const output = formatSyncAddResult(
      await addSyncTarget(
        {
          secret: flags.secret,
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
