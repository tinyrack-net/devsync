import type { Command } from "commander";
import { z } from "zod";

import {
  defaultWebRequestTimeoutMs,
  fetchWithTimeout,
  formatInputIssues,
  isJsonObject,
  normalizeSearchSite,
  readString,
  requireContentType,
  trimmedOptionalStringSchema,
} from "#app/web/shared.ts";

type WebSearchRequest = Readonly<{
  query: string;
  limit: number;
  timeoutMs: number;
}>;

type WebSearchResult = Readonly<{
  title: string;
  url: string;
  description: string | undefined;
}>;

type WebSearchEngine = Readonly<{
  name: string;
  search: (request: WebSearchRequest) => Promise<readonly WebSearchResult[]>;
}>;

type WebSearchEngineRegistry = Readonly<{
  defaultEngineName: string;
  get: (name: string) => WebSearchEngine | undefined;
  names: () => readonly string[];
}>;

export class WebSearchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebSearchError";
  }
}

type BraveSearchEngineDependencies = Readonly<{
  apiKey: string | undefined;
  fetchImplementation: typeof fetch;
  baseUrl?: string;
}>;

const searchCommandSchema = z.object({
  options: z.object({
    apiKey: trimmedOptionalStringSchema,
    engine: z.string().trim().min(1, "Engine name is required."),
    json: z.boolean(),
    limit: z.coerce
      .number()
      .int("Limit must be an integer.")
      .positive("Limit must be greater than 0."),
    site: trimmedOptionalStringSchema.transform((value, context) => {
      if (value === undefined) {
        return undefined;
      }

      try {
        return normalizeSearchSite(value);
      } catch (error: unknown) {
        context.addIssue({
          code: "custom",
          message:
            error instanceof Error
              ? error.message
              : "Site must be a valid hostname or absolute URL.",
        });

        return z.NEVER;
      }
    }),
    timeout: z.coerce
      .number()
      .int("Timeout must be an integer.")
      .positive("Timeout must be greater than 0."),
  }),
  query: z.string().trim().min(1, "Query must not be empty."),
});

type SearchResponse = {
  web?: {
    results?: unknown;
  };
};

const parseSearchCommandInput = (input: unknown) => {
  const result = searchCommandSchema.safeParse(input);

  if (!result.success) {
    throw new WebSearchError(formatInputIssues(result.error.issues));
  }

  return result.data;
};

const readSearchResults = (value: unknown) => {
  if (!isJsonObject(value)) {
    return [];
  }

  const { web } = value as SearchResponse;

  if (!isJsonObject(web)) {
    return [];
  }

  const { results } = web as NonNullable<SearchResponse["web"]>;

  if (!Array.isArray(results)) {
    return [];
  }

  const parsedResults = [];

  for (const entry of results) {
    if (!isJsonObject(entry)) {
      continue;
    }

    const title = readString(entry, "title");
    const url = readString(entry, "url");

    if (title === undefined || url === undefined) {
      continue;
    }

    parsedResults.push({
      title,
      url,
      description: readString(entry, "description"),
    });
  }

  return parsedResults;
};

const createRequestUrl = (
  baseUrl: string,
  query: string,
  limit: number,
): URL => {
  const url = new URL("/res/v1/web/search", baseUrl);

  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("text_decorations", "false");

  return url;
};

const buildSearchQuery = (query: string, site?: string) => {
  return site === undefined ? query : `site:${site} ${query}`;
};

export const createBraveSearchEngine = (
  dependencies: BraveSearchEngineDependencies,
) => {
  return {
    name: "brave",
    search: async ({ query, limit, timeoutMs }: WebSearchRequest) => {
      if (dependencies.apiKey === undefined || dependencies.apiKey === "") {
        throw new WebSearchError(
          "BRAVE_SEARCH_API_KEY is required for the brave search engine.",
        );
      }

      const url = createRequestUrl(
        dependencies.baseUrl ?? "https://api.search.brave.com",
        query,
        limit,
      );

      let response: Response;

      try {
        response = await fetchWithTimeout({
          url,
          timeoutMs,
          subject: "Brave search request",
          fetchImplementation: dependencies.fetchImplementation,
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": dependencies.apiKey,
          },
        });
      } catch (error: unknown) {
        throw new WebSearchError(
          error instanceof Error
            ? error.message
            : "Brave search request failed.",
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        const message =
          errorText === ""
            ? `Brave search request failed with ${response.status} ${response.statusText}.`
            : `Brave search request failed with ${response.status} ${response.statusText}: ${errorText}`;

        throw new WebSearchError(message);
      }

      try {
        requireContentType(response, ["application/json"]);
      } catch (error: unknown) {
        throw new WebSearchError(
          error instanceof Error
            ? error.message
            : "Unsupported content type: unknown.",
        );
      }

      return readSearchResults(await response.json());
    },
  };
};

export const createSearchEngineRegistry = (
  defaultEngineName: string,
  engines: readonly WebSearchEngine[],
) => {
  const engineMap = new Map<string, WebSearchEngine>();

  for (const engine of engines) {
    engineMap.set(engine.name, engine);
  }

  if (!engineMap.has(defaultEngineName)) {
    throw new Error(`Unknown default search engine: ${defaultEngineName}`);
  }

  return {
    defaultEngineName,
    get: (name: string) => {
      return engineMap.get(name);
    },
    names: () => {
      return [...engineMap.keys()].sort();
    },
  };
};

export const runWebSearch = async (
  request: Readonly<{
    engineName: string;
    query: string;
    limit: number;
    json: boolean;
    site?: string;
    timeoutMs: number;
  }>,
  registry: WebSearchEngineRegistry,
) => {
  const engine = registry.get(request.engineName);

  if (engine === undefined) {
    throw new WebSearchError(
      `Unknown search engine: ${request.engineName}. Available engines: ${registry.names().join(", ")}`,
    );
  }

  const searchQuery = buildSearchQuery(request.query, request.site);
  const results = await engine.search({
    query: searchQuery,
    limit: request.limit,
    timeoutMs: request.timeoutMs,
  });

  if (request.json) {
    return `${JSON.stringify(
      {
        engine: engine.name,
        query: request.query,
        searchQuery,
        site: request.site,
        results,
      },
      null,
      2,
    )}\n`;
  }

  if (results.length === 0) {
    const siteSuffix = request.site === undefined ? "" : ` on ${request.site}`;

    return `No results found for "${request.query}" using ${engine.name}${siteSuffix}.\n`;
  }

  return results
    .map((result, index) => {
      const lines = [`${index + 1}. ${result.title}`, `   ${result.url}`];

      if (result.description !== undefined && result.description !== "") {
        lines.push(`   ${result.description}`);
      }

      return lines.join("\n");
    })
    .join("\n\n")
    .concat("\n");
};

const runSearchCommand = async (
  query: string,
  options: Record<string, unknown>,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    createSearchEngineRegistry: (
      apiKeyOverride?: string,
    ) => WebSearchEngineRegistry;
  },
  siteOverride?: string,
) => {
  const optionsWithSite = options as Record<string, unknown> & {
    site?: unknown;
  };
  const validatedInput = parseSearchCommandInput({
    options: {
      ...options,
      site: siteOverride ?? optionsWithSite.site,
    },
    query,
  });
  const output = await runWebSearch(
    {
      engineName: validatedInput.options.engine,
      query: validatedInput.query,
      limit: validatedInput.options.limit,
      json: validatedInput.options.json,
      timeoutMs: validatedInput.options.timeout,
      ...(validatedInput.options.site === undefined
        ? {}
        : {
            site: validatedInput.options.site,
          }),
    },
    dependencies.createSearchEngineRegistry(validatedInput.options.apiKey),
  );

  dependencies.io.stdout(output);
};

export const registerWebSearchCommand = (
  webCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    createSearchEngineRegistry: (
      apiKeyOverride?: string,
    ) => WebSearchEngineRegistry;
  },
) => {
  const defaultSearchEngineRegistry = dependencies.createSearchEngineRegistry();
  const availableSearchEngines = defaultSearchEngineRegistry.names().join(", ");

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
    .option(
      "-s, --site <site>",
      "Restrict results to a hostname or docs path, e.g. nodejs.org/docs",
    )
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultWebRequestTimeoutMs,
    )
    .option("--api-key <key>", "Override the API key for the selected engine")
    .action(async (query: string, options: Record<string, unknown>) => {
      await runSearchCommand(query, options, dependencies);
    });
};

export const registerWebDocsSearchCommand = (
  webCommand: Command,
  dependencies: {
    io: {
      stdout: (text: string) => void;
    };
    createSearchEngineRegistry: (
      apiKeyOverride?: string,
    ) => WebSearchEngineRegistry;
  },
) => {
  const defaultSearchEngineRegistry = dependencies.createSearchEngineRegistry();
  const availableSearchEngines = defaultSearchEngineRegistry.names().join(", ");

  webCommand
    .command("docs-search")
    .description("Search documentation within a specific site or docs path")
    .argument("<site>", "Hostname or docs base path, e.g. nodejs.org/docs")
    .argument("<query>", "Keywords to search for")
    .option(
      "-e, --engine <engine>",
      `Search engine to use. Available engines: ${availableSearchEngines}`,
      defaultSearchEngineRegistry.defaultEngineName,
    )
    .option("-l, --limit <number>", "Maximum number of results to return", "5")
    .option("--json", "Print results as JSON", false)
    .option(
      "-t, --timeout <ms>",
      "Request timeout in milliseconds",
      defaultWebRequestTimeoutMs,
    )
    .option("--api-key <key>", "Override the API key for the selected engine")
    .action(
      async (site: string, query: string, options: Record<string, unknown>) => {
        await runSearchCommand(query, options, dependencies, site);
      },
    );
};
