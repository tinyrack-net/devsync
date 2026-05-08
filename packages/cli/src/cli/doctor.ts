import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { DotweaveError } from "#app/lib/error.ts";
import { type DoctorCheck, runDoctorChecks } from "#app/services/doctor.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { c, S } from "#app/services/terminal/theme.ts";

type DoctorFlags = Record<string, never>;

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
      return c.success(S.success);
    case "warn":
      return c.warn(S.warn);
    case "fail":
      return c.error(S.error);
  }
};

const doctorCommand = buildCommand<DoctorFlags, [], ApplicationContext>({
  docs: {
    brief:
      "Check sync directory, config, age identity, and tracked local paths",
    fullDescription:
      "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where dotweave expects them.",
  },
  async func() {
    const logger = createCliLogger();

    const spin = logger.spinner("Running checks...");
    const result = await runDoctorChecks();
    spin.stop();

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

    const summary = c.dim(
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

    if (nonOkChecks.length > 0) {
      for (const check of nonOkChecks.slice(0, 3)) {
        logger.log(
          `  ${formatCheckIcon(check.level)} ${normalizeCheckId(check.checkId)} — ${stripTrailingPeriod(check.detail)}`,
        );
      }
      if (nonOkChecks.length > 3) {
        logger.log(c.dim(`  ... ${nonOkChecks.length - 3} more issues`));
      }
    }

    if (result.hasFailures) {
      const error = new DotweaveError(
        "Doctor found issues.",
      ) as DotweaveError & { exitCode: number };
      error.exitCode = 1;
      throw error;
    }
  },
  parameters: {
    flags: {},
  },
});

export default doctorCommand;
