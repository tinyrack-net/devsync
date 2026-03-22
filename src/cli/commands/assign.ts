import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncMachineAssignResult } from "#app/lib/output.ts";
import { assignSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncAssign extends BaseCommand {
  public static override summary = "Assign machines to a tracked path";

  public static override description =
    "Replace the machine list for a tracked file entry or a child path inside a tracked directory. Use --path for directory entries.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig --machine default --machine work",
    "<%= config.bin %> <%= command.id %> ~/.config/zsh --machine default --machine work --path secrets.zsh",
  ];

  public static override args = {
    target: Args.string({
      description: "Tracked entry (local path or repository path)",
      required: true,
    }),
  };

  public static override flags = {
    machine: Flags.string({
      description: "Machine name to assign",
      multiple: true,
      required: true,
      summary: "Machine name",
    }),
    path: Flags.string({
      description: "Child path within a directory entry to assign machines to",
      summary: "Child path for directory entries",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncAssign);

    this.print(
      formatSyncMachineAssignResult(
        await assignSyncMachines(
          {
            machines: flags.machine,
            path: flags.path,
            target: args.target,
          },
          createSyncContext(),
        ),
      ),
    );
  }
}
