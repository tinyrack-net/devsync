import { BaseCommand } from "#app/cli/base-command.js";

export default class SyncDoctor extends BaseCommand {
  public static override summary =
    "Check sync repository, config, age identity, and tracked local paths";

  public static override description =
    "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where devsync expects them.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncDoctor);
    const [{ formatSyncDoctorResult }, { runSyncDoctor }] = await Promise.all([
      import("#app/lib/output.js"),
      import("#app/services/doctor.js"),
    ]);
    const result = await runSyncDoctor(
      process.env,
      this.createProgressReporter(flags.verbose),
    );

    this.print(formatSyncDoctorResult(result, { verbose: flags.verbose }));

    if (result.hasFailures) {
      this.exit(1);
    }
  }
}
