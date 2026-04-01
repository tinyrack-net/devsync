import { buildCommand } from "@stricli/core";
import {
  type DoctorCheck,
  type DoctorResult,
  runDoctorChecks,
} from "#app/services/doctor.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";

const normalizeCheckId = (checkId: string) => {
  switch (checkId) {
    case "age":
      return "identity";
    case "local-paths":
      return "local";
    default:
      return checkId;
  }
};

const stripTrailingPeriod = (value: string) => {
  return value.endsWith(".") ? value.slice(0, -1) : value;
};

const formatDoctorCheck = (check: DoctorCheck) => {
  return `${check.level}: ${normalizeCheckId(check.checkId)} - ${stripTrailingPeriod(check.detail)}`;
};

const formatDoctorSummary = (result: DoctorResult) => {
  let okCount = 0;
  let warningCount = 0;
  let failureCount = 0;

  for (const check of result.checks) {
    if (check.level === "ok") {
      okCount += 1;
      continue;
    }

    if (check.level === "warn") {
      warningCount += 1;
      continue;
    }

    failureCount += 1;
  }

  return `${okCount} ok, ${warningCount} warnings, ${failureCount} failures`;
};

const formatDoctorOutput = (result: DoctorResult, verbose = false) => {
  const nonOkChecks = result.checks.filter((check) => check.level !== "ok");

  return output(
    result.hasFailures
      ? "Doctor found issues"
      : result.hasWarnings
        ? "Doctor completed with warnings"
        : "Doctor passed",
    `summary: ${formatDoctorSummary(result)}`,
    ...(verbose
      ? result.checks.map((check) => formatDoctorCheck(check))
      : nonOkChecks.length === 0
        ? ["checks: all reported checks passed"]
        : [
            ...nonOkChecks.slice(0, 3).map((check) => formatDoctorCheck(check)),
            ...(nonOkChecks.length > 3
              ? [`more issues: ${nonOkChecks.length - 3}`]
              : []),
          ]),
    verbose && `sync dir: ${result.syncDirectory}`,
    verbose && `config: ${result.configPath}`,
  );
};

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
    const result = await runDoctorChecks(createProgressReporter(verbose));

    print(formatDoctorOutput(result, verbose));

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
