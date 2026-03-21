import { Args } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncSetResult } from "#app/lib/output.ts";
import { setSyncEntryMode } from "#app/services/entry.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncEntryMode extends BaseCommand {
  public static override summary = "Set the mode for a tracked root entry";

  public static override description =
    "Change the root mode for a tracked entry. Use this for tracked files and directory roots; use 'devsync rule set' for child paths inside tracked directories.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> secret ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ignore ~/.config/zsh",
  ];

  public static override args = {
    state: Args.string({
      description:
        "Mode to apply. normal keeps plain files in sync, secret encrypts synced artifacts, and ignore skips the target during push and pull.",
      options: ["normal", "secret", "ignore"],
      required: true,
    }),
    target: Args.string({
      description: "Tracked root path to update",
      required: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args } = await this.parse(SyncEntryMode);
    const output = formatSyncSetResult(
      await setSyncEntryMode(
        {
          state: args.state as "ignore" | "normal" | "secret",
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
