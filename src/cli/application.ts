import { readFileSync } from "node:fs";

import {
  type Application,
  type ApplicationText,
  buildApplication,
  run,
  text_en,
} from "@stricli/core";
import { buildRootRoute } from "#app/cli/commands/index.js";
import { createCliContext, type DevsyncCliContext } from "#app/cli/common.js";
import { formatErrorMessage } from "#app/lib/output.js";

type CommandError = Error & {
  exitCode?: number;
};

const readPackageVersion = () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
  };

  return packageJson.version;
};

const formatRuntimeError = (error: unknown) => {
  return formatErrorMessage(
    error instanceof Error ? error : new Error(String(error)),
  );
};

const devsyncText: ApplicationText = {
  ...text_en,
  commandErrorResult: (error) => {
    return formatErrorMessage(error);
  },
  exceptionWhileLoadingCommandContext: (error) => {
    return formatRuntimeError(error);
  },
  exceptionWhileLoadingCommandFunction: (error) => {
    return formatRuntimeError(error);
  },
  exceptionWhileRunningCommand: (error) => {
    return formatRuntimeError(error);
  },
  noCommandRegisteredForInput: ({ corrections, input }) => {
    const suggestion =
      corrections.length === 0
        ? ""
        : ` Did you mean ${corrections.map((entry) => `"${entry}"`).join(", ")}?`;

    return `Command "${input}" not found.${suggestion}\n`;
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

let application: Application<DevsyncCliContext> | undefined;

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
    loadText: () => devsyncText,
  },
  name: "devsync",
  scanner: {
    caseStyle: "allow-kebab-for-camel",
  },
  versionInfo: {
    currentVersion: `devsync/${readPackageVersion()}`,
  },
});

export const cliApplication = application;

export const runCli = async (inputs: readonly string[]) => {
  await run(cliApplication, inputs, createCliContext());
};
