import { Command, CommanderError } from "commander";
import { z } from "zod";

import { createBraveSearchEngine } from "./web/brave.ts";
import {
  type WebCrawlRequest,
  type WebDiscoveryService,
  createWebDiscoveryService,
  formatWebCrawl,
  formatWebRobots,
  formatWebSitemap,
  webCrawlOutputFormats,
  webRobotsOutputFormats,
  webSitemapOutputFormats,
} from "./web/discovery.ts";
import {
  type WebDocumentLoader,
  type WebPageCodeBlocksRequest,
  type WebPageExtractRequest,
  type WebPageInspector,
  type WebPageLinksRequest,
  createFetchWebDocumentLoader,
  createFetchWebPageInspector,
  formatWebPageCodeBlocks,
  formatWebPageExtract,
  formatWebPageLinks,
  formatWebPageMetadata,
  formatWebPageTables,
  webPageCodeOutputFormats,
  webPageExtractOutputFormats,
  webPageLinksOutputFormats,
  webPageMetadataOutputFormats,
  webPageTableOutputFormats,
} from "./web/document.ts";
import { createFetchWebClient } from "./web/fetch-client.ts";
import { createFetchWebPageReader } from "./web/fetch-reader.ts";
import {
  WebPageReadError,
  type WebPageReadRequest,
  type WebPageReader,
  formatWebPageContent,
  webPageOutputFormats,
} from "./web/read.ts";
import {
  type WebSearchEngineRegistry,
  WebSearchError,
  createSearchEngineRegistry,
  runWebSearch,
} from "./web/search.ts";

export type PackageInfo = Readonly<{
  name: string;
  version: string;
}>;

export type CliIo = Readonly<{
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}>;

export type CliServices = Readonly<{
  createSearchEngineRegistry: (
    apiKeyOverride?: string,
  ) => WebSearchEngineRegistry;
  webDiscovery: WebDiscoveryService;
  webPageInspector: WebPageInspector;
  webPageReader: WebPageReader;
}>;

class CliValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

const defaultTimeoutMs = "10000";

const createPositiveIntegerSchema = (name: string) => {
  return z.coerce
    .number()
    .int(`${name} must be an integer.`)
    .positive(`${name} must be greater than 0.`);
};

const createNonNegativeIntegerSchema = (name: string) => {
  return z.coerce
    .number()
    .int(`${name} must be an integer.`)
    .min(0, `${name} must be greater than or equal to 0.`);
};

const trimmedOptionalStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    return value === undefined || value === "" ? undefined : value;
  });

const helloCommandSchema = z.object({
  name: trimmedOptionalStringSchema.transform((value) => {
    return value ?? "world";
  }),
});

const apiKeySchema = trimmedOptionalStringSchema;

const urlSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "URL must be a valid absolute URL.",
      });

      return;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "URL must use http or https.",
      });
    }
  });

const webSearchCommandOptionsSchema = z.object({
  apiKey: apiKeySchema,
  engine: z.string().trim().min(1, "Engine name is required."),
  json: z.boolean(),
  limit: createPositiveIntegerSchema("Limit"),
});

const webSearchCommandSchema = z.object({
  options: webSearchCommandOptionsSchema,
  query: z.string().trim().min(1, "Query must not be empty."),
});

const webReadCommandOptionsSchema = z.object({
  format: z.enum(webPageOutputFormats),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webReadCommandSchema = z.object({
  options: webReadCommandOptionsSchema,
  url: urlSchema,
});

const webMetaCommandOptionsSchema = z.object({
  format: z.enum(webPageMetadataOutputFormats),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webMetaCommandSchema = z.object({
  options: webMetaCommandOptionsSchema,
  url: urlSchema,
});

const webLinksCommandOptionsSchema = z
  .object({
    externalOnly: z.boolean(),
    format: z.enum(webPageLinksOutputFormats),
    internalOnly: z.boolean(),
    timeout: createPositiveIntegerSchema("Timeout"),
    unique: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.externalOnly && value.internalOnly) {
      context.addIssue({
        code: "custom",
        message: "Cannot combine internalOnly and externalOnly.",
        path: ["internalOnly"],
      });
    }
  });

const webLinksCommandSchema = z.object({
  options: webLinksCommandOptionsSchema,
  url: urlSchema,
});

const webExtractCommandOptionsSchema = z.object({
  all: z.boolean(),
  format: z.enum(webPageExtractOutputFormats),
  selector: z.string().trim().min(1, "Selector must not be empty."),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webExtractCommandSchema = z.object({
  options: webExtractCommandOptionsSchema,
  url: urlSchema,
});

const webCodeCommandOptionsSchema = z.object({
  format: z.enum(webPageCodeOutputFormats),
  language: trimmedOptionalStringSchema,
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webCodeCommandSchema = z.object({
  options: webCodeCommandOptionsSchema,
  url: urlSchema,
});

const webTablesCommandOptionsSchema = z.object({
  format: z.enum(webPageTableOutputFormats),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webTablesCommandSchema = z.object({
  options: webTablesCommandOptionsSchema,
  url: urlSchema,
});

const webRobotsCommandOptionsSchema = z.object({
  format: z.enum(webRobotsOutputFormats),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webRobotsCommandSchema = z.object({
  options: webRobotsCommandOptionsSchema,
  url: urlSchema,
});

const webSitemapCommandOptionsSchema = z.object({
  format: z.enum(webSitemapOutputFormats),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webSitemapCommandSchema = z.object({
  options: webSitemapCommandOptionsSchema,
  url: urlSchema,
});

const webCrawlCommandOptionsSchema = z.object({
  exclude: trimmedOptionalStringSchema,
  format: z.enum(webCrawlOutputFormats),
  include: trimmedOptionalStringSchema,
  maxDepth: createNonNegativeIntegerSchema("Max depth"),
  maxPages: createPositiveIntegerSchema("Max pages"),
  sameOrigin: z.boolean(),
  timeout: createPositiveIntegerSchema("Timeout"),
});

const webCrawlCommandSchema = z.object({
  options: webCrawlCommandOptionsSchema,
  url: urlSchema,
});

const formatZodIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "input" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
};

const parseCommandInput = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new CliValidationError(formatZodIssues(result.error.issues));
  }

  return result.data;
};

const createDefaultWebDocumentLoader = (): WebDocumentLoader => {
  return createFetchWebDocumentLoader(
    createFetchWebClient({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
  );
};

export const createDefaultCliServices = (): CliServices => {
  const { BRAVE_SEARCH_API_KEY: braveSearchApiKey } = process.env;
  const documentLoader = createDefaultWebDocumentLoader();

  return {
    createSearchEngineRegistry: (apiKeyOverride) => {
      return createSearchEngineRegistry("brave", [
        createBraveSearchEngine({
          apiKey: apiKeyOverride ?? braveSearchApiKey,
          fetchImplementation: fetch,
        }),
      ]);
    },
    webDiscovery: createWebDiscoveryService(
      createFetchWebClient({
        fetchImplementation: fetch,
        userAgent: "devtools/0.1.0",
      }),
      documentLoader,
    ),
    webPageInspector: createFetchWebPageInspector(documentLoader),
    webPageReader: createFetchWebPageReader({
      fetchImplementation: fetch,
      userAgent: "devtools/0.1.0",
    }),
  };
};

const runWebRead = async (
  services: CliServices,
  request: WebPageReadRequest,
  format: (typeof webPageOutputFormats)[number],
): Promise<string> => {
  const content = await services.webPageReader.read(request);

  return formatWebPageContent(content, format);
};

const runWebMeta = async (
  services: CliServices,
  request: WebPageReadRequest,
  format: (typeof webPageMetadataOutputFormats)[number],
): Promise<string> => {
  const metadata = await services.webPageInspector.meta(request);

  return formatWebPageMetadata(metadata, format);
};

const runWebLinks = async (
  services: CliServices,
  request: WebPageLinksRequest,
  format: (typeof webPageLinksOutputFormats)[number],
): Promise<string> => {
  const result = await services.webPageInspector.links(request);

  return formatWebPageLinks(result, format);
};

const runWebExtract = async (
  services: CliServices,
  request: WebPageExtractRequest,
  format: (typeof webPageExtractOutputFormats)[number],
): Promise<string> => {
  const result = await services.webPageInspector.extract(request);

  return formatWebPageExtract(result, format);
};

const runWebCode = async (
  services: CliServices,
  request: WebPageCodeBlocksRequest,
  format: (typeof webPageCodeOutputFormats)[number],
): Promise<string> => {
  const result = await services.webPageInspector.code(request);

  return formatWebPageCodeBlocks(result, format);
};

const runWebTables = async (
  services: CliServices,
  request: WebPageReadRequest,
  format: (typeof webPageTableOutputFormats)[number],
): Promise<string> => {
  const result = await services.webPageInspector.tables(request);

  return formatWebPageTables(result, format);
};

const runWebRobots = async (
  services: CliServices,
  request: WebPageReadRequest,
  format: (typeof webRobotsOutputFormats)[number],
): Promise<string> => {
  const result = await services.webDiscovery.robots(request);

  return formatWebRobots(result, format);
};

const runWebSitemap = async (
  services: CliServices,
  request: WebPageReadRequest,
  format: (typeof webSitemapOutputFormats)[number],
): Promise<string> => {
  const result = await services.webDiscovery.sitemap(request);

  return formatWebSitemap(result, format);
};

const runWebCrawl = async (
  services: CliServices,
  request: WebCrawlRequest,
  format: (typeof webCrawlOutputFormats)[number],
): Promise<string> => {
  const result = await services.webDiscovery.crawl(request);

  return formatWebCrawl(result, format);
};

export const createProgram = (
  packageInfo: PackageInfo,
  io: CliIo,
  services: CliServices,
): Command => {
  const program = new Command();
  const defaultSearchEngineRegistry = services.createSearchEngineRegistry();
  const availableSearchEngines = defaultSearchEngineRegistry.names().join(", ");

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

  program
    .command("hello")
    .description("Print a friendly greeting")
    .argument("[name]", "Name to greet")
    .action((name?: string) => {
      const validatedInput = parseCommandInput(helloCommandSchema, {
        name,
      });

      io.stdout(`Hello, ${validatedInput.name}!\n`);
    });

  const webCommand = program.command("web").description("Web utilities");

  webCommand
    .command("search")
    .description("Search the web")
    .argument("<query>", "Keywords to search for")
    .option(
      "-e, --engine <engine>",
      `Search engine to use. Available engines: ${availableSearchEngines}`,
      defaultSearchEngineRegistry.defaultEngineName,
    )
    .option("-l, --limit <number>", "Maximum number of results to return", "5")
    .option("--json", "Print results as JSON", false)
    .option("--api-key <key>", "Override the API key for the selected engine")
    .action(async (query: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webSearchCommandSchema, {
        options,
        query,
      });
      const searchEngineRegistry = services.createSearchEngineRegistry(
        validatedInput.options.apiKey,
      );
      const output = await runWebSearch(
        {
          engineName: validatedInput.options.engine,
          json: validatedInput.options.json,
          limit: validatedInput.options.limit,
          query: validatedInput.query,
        },
        searchEngineRegistry,
      );

      io.stdout(output);
    });

  webCommand
    .command("read")
    .description("Read a web page and convert it to structured output")
    .argument("<url>", "Web page URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webPageOutputFormats.join(", ")}`,
      "markdown",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webReadCommandSchema, {
        options,
        url,
      });
      const output = await runWebRead(
        services,
        {
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("meta")
    .description("Read metadata from a web page")
    .argument("<url>", "Web page URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webPageMetadataOutputFormats.join(", ")}`,
      "json",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webMetaCommandSchema, {
        options,
        url,
      });
      const output = await runWebMeta(
        services,
        {
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("links")
    .description("Extract links from a web page")
    .argument("<url>", "Web page URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webPageLinksOutputFormats.join(", ")}`,
      "text",
    )
    .option("--unique", "Deduplicate links by URL", false)
    .option("--internal-only", "Include only same-origin links", false)
    .option("--external-only", "Include only external links", false)
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webLinksCommandSchema, {
        options,
        url,
      });
      const output = await runWebLinks(
        services,
        {
          externalOnly: validatedInput.options.externalOnly,
          internalOnly: validatedInput.options.internalOnly,
          timeoutMs: validatedInput.options.timeout,
          unique: validatedInput.options.unique,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("extract")
    .description("Extract content from a page with a CSS selector")
    .argument("<url>", "Web page URL")
    .requiredOption("-s, --selector <selector>", "CSS selector to extract")
    .option("--all", "Return all matches", false)
    .option(
      "-f, --format <format>",
      `Output format: ${webPageExtractOutputFormats.join(", ")}`,
      "markdown",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webExtractCommandSchema, {
        options,
        url,
      });
      const output = await runWebExtract(
        services,
        {
          all: validatedInput.options.all,
          selector: validatedInput.options.selector,
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("code")
    .description("Extract code blocks from a page")
    .argument("<url>", "Web page URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webPageCodeOutputFormats.join(", ")}`,
      "markdown",
    )
    .option("-l, --language <language>", "Filter by language")
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webCodeCommandSchema, {
        options,
        url,
      });
      const output = await runWebCode(
        services,
        {
          language: validatedInput.options.language,
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("tables")
    .description("Extract tables from a page")
    .argument("<url>", "Web page URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webPageTableOutputFormats.join(", ")}`,
      "markdown",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webTablesCommandSchema, {
        options,
        url,
      });
      const output = await runWebTables(
        services,
        {
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("robots")
    .description("Fetch and parse robots.txt")
    .argument("<url>", "Web page or site URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webRobotsOutputFormats.join(", ")}`,
      "json",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webRobotsCommandSchema, {
        options,
        url,
      });
      const output = await runWebRobots(
        services,
        {
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("sitemap")
    .description("Fetch and parse a sitemap")
    .argument("<url>", "Site URL or sitemap URL")
    .option(
      "-f, --format <format>",
      `Output format: ${webSitemapOutputFormats.join(", ")}`,
      "json",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webSitemapCommandSchema, {
        options,
        url,
      });
      const output = await runWebSitemap(
        services,
        {
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  webCommand
    .command("crawl")
    .description("Crawl a site with bounded depth and page count")
    .argument("<url>", "Root URL to crawl")
    .option(
      "-f, --format <format>",
      `Output format: ${webCrawlOutputFormats.join(", ")}`,
      "text",
    )
    .option("--max-pages <number>", "Maximum pages to crawl", "10")
    .option("--max-depth <number>", "Maximum crawl depth", "1")
    .option("--include <text>", "Only include URLs containing this text")
    .option("--exclude <text>", "Exclude URLs containing this text")
    .option("--no-same-origin", "Allow crawling across origins")
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultTimeoutMs,
    )
    .action(async (url: string, options: Record<string, unknown>) => {
      const validatedInput = parseCommandInput(webCrawlCommandSchema, {
        options,
        url,
      });
      const output = await runWebCrawl(
        services,
        {
          exclude: validatedInput.options.exclude,
          include: validatedInput.options.include,
          maxDepth: validatedInput.options.maxDepth,
          maxPages: validatedInput.options.maxPages,
          sameOrigin: validatedInput.options.sameOrigin,
          timeoutMs: validatedInput.options.timeout,
          url: validatedInput.url,
        },
        validatedInput.options.format,
      );

      io.stdout(output);
    });

  return program;
};

export const runCli = async (
  args: readonly string[],
  packageInfo: PackageInfo,
  io: CliIo,
  services: CliServices = createDefaultCliServices(),
): Promise<number> => {
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
      error instanceof CliValidationError ||
      error instanceof WebPageReadError ||
      error instanceof WebSearchError
    ) {
      io.stderr(`error: ${error.message}\n`);
      return 1;
    }

    throw error;
  }
};
