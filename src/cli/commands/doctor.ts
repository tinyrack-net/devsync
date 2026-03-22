import { BaseCommand } from "#app/cli/base-command.js";
import { formatSyncDoctorResult } from "#app/lib/output.js";
import { runSyncDoctor } from "#app/services/doctor.js";
import { createSyncContext } from "#app/services/runtime.js";

export default class SyncDoctor extends BaseCommand {
  public static override summary =
    "Check sync repository, config, age identity, and tracked local paths";

  public static override description =
    "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where devsync expects them.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    await this.parse(SyncDoctor);
    const result = await runSyncDoctor(createSyncContext());

    this.print(formatSyncDoctorResult(result));

    if (result.hasFailures) {
      this.exit(1);
    }
  }
}
