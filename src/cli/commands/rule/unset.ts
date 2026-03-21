import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncSetResult } from "#app/lib/output.ts";
import { unsetSyncRule } from "#app/services/rule.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncRuleUnset extends BaseCommand {
  public static override summary =
    "Remove a rule from a child path inside a tracked directory";

  public static override description =
    "Remove an exact or subtree rule from the shared base layer or a specific machine layer. After removal, the target falls back to inherited behavior.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.config/zsh/secrets.zsh",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh/cache --recursive",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh/secrets.zsh --machine work",
  ];

  public static override args = {
    target: Args.string({
      description:
        "Child path inside a tracked directory root, as a local path or repository path",
      required: true,
    }),
  };

  public static override flags = {
    recursive: Flags.boolean({
      default: false,
      summary: "Remove the subtree rule for a directory target",
      description:
        "When the target is a directory, remove the subtree rule. Omit this flag for a single file rule.",
    }),
    machine: Flags.string({
      summary: "Remove the rule from a specific machine layer",
      description:
        "When omitted, the rule is removed from the shared base layer.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncRuleUnset);
    const output = formatSyncSetResult(
      await unsetSyncRule(
        {
          machine: flags.machine,
          recursive: flags.recursive,
          target: args.target,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
