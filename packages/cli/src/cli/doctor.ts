import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { type DoctorCheck, runDoctorChecks } from "#app/services/doctor.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

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

const formatCheckIcon = (level: DoctorCheck["level"]) => {
  switch (level) {
    case "ok":
      return pc.green("✔");
    case "warn":
      return pc.yellow("⚠");
    case "fail":
      return pc.red("✖");
  }
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
      "Check sync directory, config, age identity, and tracked local paths",
    fullDescription:
      "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where devsync expects them.",
  },
  async func(flags) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;

    const result = await runDoctorChecks(reporter);

    let okCount = 0;
    let warningCount = 0;
    let failureCount = 0;

    for (const check of result.checks) {
      if (check.level === "ok") {
        okCount += 1;
      } else if (check.level === "warn") {
        warningCount += 1;
      } else {
        failureCount += 1;
      }
    }

    const summary = pc.dim(
      `(${okCount} ok · ${warningCount} warnings · ${failureCount} failures)`,
    );

    if (result.hasFailures) {
      logger.fail(`Doctor found issues ${summary}`);
    } else if (result.hasWarnings) {
      logger.warn(`Doctor completed with warnings ${summary}`);
    } else {
      logger.success(`Doctor passed ${summary}`);
    }

    const nonOkChecks = result.checks.filter((check) => check.level !== "ok");

    if (verbose) {
      for (const check of result.checks) {
        logger.log(
          `  ${formatCheckIcon(check.level)} ${normalizeCheckId(check.checkId)} – ${stripTrailingPeriod(check.detail)}`,
        );
      }
    } else if (nonOkChecks.length > 0) {
      for (const check of nonOkChecks.slice(0, 3)) {
        logger.log(
          `  ${formatCheckIcon(check.level)} ${normalizeCheckId(check.checkId)} – ${stripTrailingPeriod(check.detail)}`,
        );
      }
      if (nonOkChecks.length > 3) {
        logger.log(pc.dim(`  ... ${nonOkChecks.length - 3} more issues`));
      }
    }

    if (verbose) {
      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.configPath}`));
    }

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
