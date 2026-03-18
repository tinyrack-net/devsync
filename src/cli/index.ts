import { Command, CommanderError } from "commander";
import {
  createFetchWebPageReader,
  registerWebFetchCommand,
  WebPageReadError,
} from "#app/web/fetch.ts";
import {
  createBraveSearchEngine,
  createSearchEngineRegistry,
  registerWebSearchCommand,
  WebSearchError,
} from "#app/web/search.ts";

export const createDefaultCliServices = () => {
  const { BRAVE_SEARCH_API_KEY: braveSearchApiKey } = process.env;

  return {
    createSearchEngineRegistry: (apiKeyOverride?: string) => {
      return createSearchEngineRegistry("brave", [
        createBraveSearchEngine({
          apiKey: apiKeyOverride ?? braveSearchApiKey,
          fetchImplementation: fetch,
        }),
      ]);
    },
    webPageReader: createFetchWebPageReader({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
  };
};

export type CliServices = ReturnType<typeof createDefaultCliServices>;

type PackageInfo = {
  name: string;
  version: string;
};

type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export const createProgram = (
  packageInfo: PackageInfo,
  io: CliIo,
  services: CliServices,
) => {
  const program = new Command();

  program
    .name(packageInfo.name)
    .description("devtools CLI")
    .helpOption("-h, --help", "Show help")
    .version(packageInfo.version, "-v, --version", "Show version")
    .showHelpAfterError();

  program.configureOutput({
    outputError: (text, write) => {
      write(text);
    },
    writeErr: (text) => {
      io.stderr(text);
    },
    writeOut: (text) => {
      io.stdout(text);
    },
  });

  program.exitOverride();

  const webCommand = program.command("web").description("Web utilities");

  registerWebSearchCommand(webCommand, {
    io,
    createSearchEngineRegistry: services.createSearchEngineRegistry,
  });
  registerWebFetchCommand(webCommand, {
    io,
    webPageReader: services.webPageReader,
  });

  return program;
};

export const runCli = async (
  args: readonly string[],
  packageInfo: PackageInfo,
  io: CliIo,
  services: CliServices = createDefaultCliServices(),
) => {
  const program = createProgram(packageInfo, io, services);

  if (args.length === 0) {
    program.outputHelp();
    return 0;
  }

  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    if (error instanceof WebPageReadError || error instanceof WebSearchError) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }

    throw error;
  }
};
