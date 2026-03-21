import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncSetResult } from "#app/lib/output.ts";
import { setSyncRule } from "#app/services/rule.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncRuleSet extends BaseCommand {
  public static override summary =
    "Set a rule for a child path inside a tracked directory";

  public static override description =
    "Change how devsync treats a child file or subtree inside an already tracked directory root. Use 'devsync entry mode' for tracked roots instead.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ignore ~/.config/zsh/cache --recursive",
    "<%= config.bin %> <%= command.id %> ignore ~/.config/zsh/secrets.zsh",
    "<%= config.bin %> <%= command.id %> secret ~/.config/zsh/secrets.zsh --machine work",
  ];

  public static override args = {
    state: Args.string({
      description:
        "Mode to apply. normal keeps plain files in sync, secret encrypts synced artifacts, and ignore skips the target during push and pull.",
      options: ["normal", "secret", "ignore"],
      required: true,
    }),
    target: Args.string({
      description:
        "Child path inside a tracked directory root, as a local path or repository path",
      required: true,
    }),
  };

  public static override flags = {
    recursive: Flags.boolean({
      default: false,
      summary: "Apply the rule to a directory subtree",
      description:
        "When the target is a directory, update the whole subtree. Omit this flag for a single file rule.",
    }),
    machine: Flags.string({
      summary: "Set the rule in a specific machine layer",
      description:
        "When omitted, the rule is written to the shared base layer.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncRuleSet);
    const output = formatSyncSetResult(
      await setSyncRule(
        {
          machine: flags.machine,
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
