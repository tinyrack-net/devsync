import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { type DoctorCheck, runDoctorChecks } from "#app/services/doctor.ts";
import { type DotweaveCliContext } from "#app/services/terminal/cli-runtime.ts";
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
  Record<string, never>,
  [],
  DotweaveCliContext
>({
  docs: {
    brief:
      "Check sync directory, config, age identity, and tracked local paths",
    fullDescription:
      "Run health checks for the local sync setup, including repository availability, config validity, age identity configuration, and whether tracked local paths still exist where dotweave expects them.",
  },
  async func() {
    const logger = createCliLogger();

    const result = await runDoctorChecks();

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

    if (nonOkChecks.length > 0) {
      for (const check of nonOkChecks.slice(0, 3)) {
        logger.log(
          `  ${formatCheckIcon(check.level)} ${normalizeCheckId(check.checkId)} – ${stripTrailingPeriod(check.detail)}`,
        );
      }
      if (nonOkChecks.length > 3) {
        logger.log(pc.dim(`  ... ${nonOkChecks.length - 3} more issues`));
      }
    }

    if (result.hasFailures) {
      process.exitCode = 1;
    }
  },
  parameters: {
    flags: {},
  },
});

export default doctorCommand;
