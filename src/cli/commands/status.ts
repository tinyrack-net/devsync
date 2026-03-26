import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";

export default class SyncStatus extends BaseCommand {
  public static override summary =
    "Show planned push and pull changes for the current sync config";

  public static override description =
    "Compare the tracked local files with the sync repository and report what push would write to the repository and what pull would write back locally.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --profile work",
  ];

  public static override flags = {
    profile: Flags.string({
      summary: "Use a specific profile layer for this command",
      description:
        "Override the persisted active profile for this status command only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncStatus);
    const progress = this.createProgressReporter(flags.verbose);
    const [{ formatSyncStatusResult }, { getSyncStatus }] = await Promise.all([
      import("#app/lib/output.js"),
      import("#app/services/status.js"),
    ]);
    const output = formatSyncStatusResult(
      await getSyncStatus(process.env, {
        profile: flags.profile,
        reporter: progress,
      }),
      { verbose: flags.verbose },
    );

    this.print(output);
  }
}
