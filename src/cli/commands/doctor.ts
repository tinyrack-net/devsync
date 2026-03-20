import { Command } from "@oclif/core";

import { formatSyncDoctorResult } from "#app/cli/sync-output.ts";
import { runSyncDoctor } from "#app/services/doctor.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncDoctor extends Command {
  public static override summary =
    "Check sync repository, config, age identity, and tracked local paths";

  public override async run(): Promise<void> {
    const result = await runSyncDoctor(createSyncContext());

    process.stdout.write(formatSyncDoctorResult(result));

    if (result.hasFailures) {
      this.exit(1);
    }
  }
}
