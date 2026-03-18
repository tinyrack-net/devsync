import { Command, CommanderError } from "commander";
import {
  createFetchWebPageReader,
  registerWebFetchCommand,
  WebPageReadError,
} from "#app/web/fetch.ts";
import {
  createWebPageInspector,
  registerWebInspectCommand,
  WebPageInspectError,
} from "#app/web/inspect.ts";
import {
  createWebPageLinkReader,
  registerWebLinksCommand,
  WebPageLinksError,
} from "#app/web/links.ts";
import {
  createBraveSearchEngine,
  createSearchEngineRegistry,
  registerWebDocsSearchCommand,
  registerWebSearchCommand,
  WebSearchError,
} from "#app/web/search.ts";
import {
  createWebSitemapReader,
  registerWebSitemapCommand,
  WebSitemapError,
} from "#app/web/sitemap.ts";

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
    webPageInspector: createWebPageInspector({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
    webPageLinkReader: createWebPageLinkReader({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
    webSitemapReader: createWebSitemapReader({
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
  registerWebDocsSearchCommand(webCommand, {
    io,
    createSearchEngineRegistry: services.createSearchEngineRegistry,
  });
  registerWebFetchCommand(webCommand, {
    io,
    webPageReader: services.webPageReader,
  });
  registerWebInspectCommand(webCommand, {
    io,
    webPageInspector: services.webPageInspector,
  });
  registerWebLinksCommand(webCommand, {
    io,
    webPageLinkReader: services.webPageLinkReader,
  });
  registerWebSitemapCommand(webCommand, {
    io,
    webSitemapReader: services.webSitemapReader,
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

    if (
      error instanceof WebPageReadError ||
      error instanceof WebPageInspectError ||
      error instanceof WebPageLinksError ||
      error instanceof WebSearchError ||
      error instanceof WebSitemapError
    ) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }

    throw error;
  }
};
