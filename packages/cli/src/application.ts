import {
  type ApplicationText,
  buildApplication,
  run,
  text_en,
} from "@stricli/core";
import { setApplication } from "#app/cli/autocomplete.ts";
import { buildRootRoute } from "#app/cli/index.ts";
import { CONSTANTS } from "#app/config/constants.ts";
import { formatDotweaveError } from "#app/lib/error.ts";
import { currentVersion } from "#app/lib/version.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type CommandError = Error & {
  exitCode?: number;
};

const errorLogger = createCliLogger({
  stderr: process.stderr,
  stdout: process.stderr,
});

const formatErrorForConsola = (error: unknown) => {
  const message = formatDotweaveError(
    error instanceof Error ? error : new Error(String(error)),
  );
  errorLogger.error(message);
  return "";
};

const dotweaveText: ApplicationText = {
  ...text_en,
  commandErrorResult: (error) => {
    return formatErrorForConsola(error);
  },
  exceptionWhileLoadingCommandContext: (error) => {
    return formatErrorForConsola(error);
  },
  exceptionWhileLoadingCommandFunction: (error) => {
    return formatErrorForConsola(error);
  },
  exceptionWhileRunningCommand: (error) => {
    return formatErrorForConsola(error);
  },
  noCommandRegisteredForInput: ({ corrections, input }) => {
    const suggestion =
      corrections.length === 0
        ? ""
        : ` Did you mean ${corrections.map((entry) => `"${entry}"`).join(", ")}?`;

    errorLogger.error(`Command "${input}" not found.${suggestion}`);
    return "";
  },
};

const resolveExitCode = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    typeof error.exitCode === "number"
  ) {
    return (error as CommandError).exitCode ?? 1;
  }

  return 1;
};

const rootRoute = buildRootRoute();

const application = buildApplication(rootRoute, {
  completion: {
    includeAliases: false,
  },
  determineExitCode: resolveExitCode,
  documentation: {
    caseStyle: "convert-camel-to-kebab",
  },
  localization: {
    defaultLocale: "en",
    loadText: () => dotweaveText,
  },
  name: CONSTANTS.APP.NAME,
  scanner: {
    caseStyle: "allow-kebab-for-camel",
  },
  versionInfo: {
    currentVersion,
  },
});

setApplication(application);

const cliApplication = application;

export const runCli = async (inputs: readonly string[]) => {
  await run(cliApplication, inputs, {
    process: {
      stdout: process.stdout,
      stderr: process.stderr,
      get env() {
        return process.env;
      },
      get exitCode() {
        return process.exitCode;
      },
      set exitCode(value) {
        process.exitCode = value;
      },
    },
  });
};
