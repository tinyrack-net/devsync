import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncAddResult, formatSyncSetResult } from "#app/lib/output.js";
import { trackSyncTarget } from "#app/services/add.js";
import { DevsyncError } from "#app/services/error.js";
import { assignSyncProfiles } from "#app/services/profile.js";
import { setSyncTargetMode } from "#app/services/set.js";

export default class SyncTrack extends BaseCommand {
  public static override summary =
    "Track local files or directories for syncing";

  public static override description =
    "Register one or more files or directories inside your home directory so devsync can mirror them into the sync repository. If a target is already tracked, its mode is updated. Targets may also be repository paths inside a tracked directory to create child entries with a specific mode.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %> ~/.gitconfig",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig ~/.zshrc ~/.config/nvim",
    "<%= config.bin %> <%= command.id %> ~/.ssh/config --mode secret",
    "<%= config.bin %> <%= command.id %> ~/.ssh/config --mode secret --profile vivident",
    "<%= config.bin %> <%= command.id %> ~/.gitconfig --profile ''",
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
    profile: Flags.string({
      multiple: true,
      summary: "Restrict syncing to specific profiles",
      description:
        "Assign one or more profile names to the tracked entries. When set, the entry is only synced on the listed profiles.",
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
    const profiles = flags.profile ?? [];
    const progress = this.createProgressReporter(flags.verbose);

    if (targets.length === 0) {
      this.error("At least one target path is required.");
    }

    const environment = process.env;
    const cwd = process.cwd();
    progress.phase(
      `Processing ${targets.length} sync target${targets.length === 1 ? "" : "s"}...`,
    );

    for (const target of targets) {
      progress.phase(`Resolving ${target}...`);

      try {
        const result = await trackSyncTarget(
          {
            profiles: profiles.length > 0 ? profiles : undefined,
            mode,
            target,
          },
          environment,
          cwd,
        );

        this.print(formatSyncAddResult(result, { verbose: flags.verbose }));
      } catch (error: unknown) {
        if (
          error instanceof DevsyncError &&
          error.code === "TARGET_NOT_FOUND"
        ) {
          progress.phase(`Updating existing target ${target}...`);
          const setResult = await setSyncTargetMode(
            {
              mode,
              target,
            },
            environment,
            cwd,
          );

          if (profiles.length > 0) {
            const isProfileClear = profiles.length === 1 && profiles[0] === "";
            await assignSyncProfiles(
              { profiles: isProfileClear ? [] : profiles, target },
              environment,
              cwd,
            );
          }

          this.print(
            formatSyncSetResult(setResult, { verbose: flags.verbose }),
          );
        } else {
          throw error;
        }
      }
    }
  }
}
