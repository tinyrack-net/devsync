import { buildCommand } from "@stricli/core";
import { formatSyncDoctorResult } from "#app/lib/output.ts";
import { runDoctor } from "#app/services/doctor.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";

const doctorCommand = buildCommand<
  {
    verbose?: boolean;
  },
  [],
  DevsyncCliContext
>({
  docs: {
    brief:
      "Check sync repository, config, age identity, and tracked local paths",
    fullDescription:
      "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where devsync expects them.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const result = await runDoctor(createProgressReporter(verbose));

    print(formatSyncDoctorResult(result, { verbose }));

    if (result.hasFailures) {
      process.exitCode = 1;
    }
  },
  parameters: {
    flags: {
      verbose: verboseFlag,
    },
  },
});

export default doctorCommand;
