import {
  type Application,
  type ApplicationText,
  buildApplication,
  run,
  text_en,
} from "@stricli/core";
import { createConsola } from "consola";
import { buildRootRoute } from "#app/cli/index.ts";
import { CONSTANTS } from "#app/config/constants.ts";
import { formatDotweaveError } from "#app/lib/error.ts";
import { currentVersion } from "#app/lib/version.ts";
import {
  createCliContext,
  type DotweaveCliContext,
} from "#app/services/terminal/cli-runtime.ts";

type CommandError = Error & {
  exitCode?: number;
};

const errorLogger = createConsola({
  formatOptions: {
    colors: process.stderr.isTTY ?? false,
    compact: true,
    date: false,
  },
  level: 3,
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

let application: Application<DotweaveCliContext> | undefined;

const getApplication = () => {
  if (application === undefined) {
    throw new Error("CLI application has not been initialized.");
  }

  return application;
};

const rootRoute = buildRootRoute(getApplication);

application = buildApplication(rootRoute, {
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

export const cliApplication = application;

export const runCli = async (inputs: readonly string[]) => {
  await run(cliApplication, inputs, createCliContext());
};
