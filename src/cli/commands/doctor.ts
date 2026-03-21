import { Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncDoctorResult } from "#app/lib/output.ts";
import { runSyncDoctor } from "#app/services/doctor.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncDoctor extends BaseCommand {
  public static override summary =
    "Check sync repository, config, age identity, and tracked local paths";

  public static override description =
    "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where devsync expects them.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --machine work",
  ];

  public static override flags = {
    machine: Flags.string({
      summary: "Use a specific machine layer for this command",
      description:
        "Override the persisted active machine for this doctor run only.",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncDoctor);
    const result = await runSyncDoctor(createSyncContext(), {
      machine: flags.machine,
    });

    this.print(formatSyncDoctorResult(result));

    if (result.hasFailures) {
      this.exit(1);
    }
  }
}
