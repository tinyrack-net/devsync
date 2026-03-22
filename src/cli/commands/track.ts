import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncAddResult, formatSyncSetResult } from "#app/lib/output.ts";
import { trackSyncTarget } from "#app/services/add.ts";
import { DevsyncError } from "#app/services/error.ts";
import { assignSyncMachines } from "#app/services/machine.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { setSyncTargetMode } from "#app/services/set.ts";

export default class SyncTrack extends BaseCommand {
  public static override summary =
    "Track local files or directories for syncing";

  public static override description =
    "Register one or more files or directories inside your home directory so devsync can mirror them into the sync repository. If a target is already tracked, its mode is updated. Targets may also be repository paths inside a tracked directory to create child entries with a specific mode.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig ~/.zshrc ~/.config/nvim",
    "<%= config.bin %> <%= command.id %> ~/.ssh/config --mode secret",
    "<%= config.bin %> <%= command.id %> ~/.ssh/config --mode secret --machine vivident",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig --machine ''",
    "<%= config.bin %> <%= command.id %> ./.zshrc",
    "<%= config.bin %> <%= command.id %> ~/.config/mytool/cache --mode ignore",
    "<%= config.bin %> <%= command.id %> .config/mytool/token.json --mode secret",
  ];

  public static override strict = false;

  public static override args = {
    targets: Args.string({
      description:
        "Local files or directories under your home directory to track, including cwd-relative paths or repository paths inside tracked directories",
      required: true,
    }),
  };

  public static override flags = {
    machine: Flags.string({
      multiple: true,
      summary: "Restrict syncing to specific machines",
      description:
        "Assign one or more machine names to the tracked entries. When set, the entry is only synced on the listed machines.",
    }),
    mode: Flags.string({
      default: "normal",
      options: ["normal", "secret", "ignore"],
      summary: "Sync mode for the tracked targets",
      description:
        "Set the sync mode. normal keeps plain files in sync, secret encrypts synced artifacts, and ignore skips the target during push and pull.",
    }),
  };

  public override async run(): Promise<void> {
    const { argv, flags } = await this.parse(SyncTrack);
    const targets = argv as string[];
    const mode = flags.mode as "ignore" | "normal" | "secret";
    const machines = flags.machine ?? [];

    if (targets.length === 0) {
      this.error("At least one target path is required.");
    }

    const context = createSyncContext();
    const results: string[] = [];

    for (const target of targets) {
      try {
        const result = await trackSyncTarget(
          {
            machines: machines.length > 0 ? machines : undefined,
            mode,
            target,
          },
          context,
        );

        results.push(formatSyncAddResult(result));
      } catch (error: unknown) {
        if (
          error instanceof DevsyncError &&
          error.code === "TARGET_NOT_FOUND"
        ) {
          const setResult = await setSyncTargetMode(
            {
              state: mode,
              target,
            },
            context,
          );

          if (machines.length > 0) {
            const isMachineClear = machines.length === 1 && machines[0] === "";
            await assignSyncMachines(
              { machines: isMachineClear ? [] : machines, target },
              context,
            );
          }

          results.push(formatSyncSetResult(setResult));
        } else {
          throw error;
        }
      }
    }

    this.print(results.join("\n"));
  }
}
