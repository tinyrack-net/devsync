import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncDoctorResult } from "#app/lib/output.ts";
import { runSyncDoctor } from "#app/services/doctor.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncDoctor extends BaseCommand {
  public static override summary =
    "Check sync repository, config, age identity, and tracked local paths";

  public override async run(): Promise<void> {
    const result = await runSyncDoctor(createSyncContext());

    this.print(formatSyncDoctorResult(result));

    if (result.hasFailures) {
      this.exit(1);
    }
  }
}
