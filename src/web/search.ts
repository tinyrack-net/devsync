import type { Command } from "commander";
import { z } from "zod";

type WebSearchRequest = Readonly<{
  query: string;
  limit: number;
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

const trimmedOptionalStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    return value === undefined || value === "" ? undefined : value;
  });

const formatInputIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "input" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
};

const searchCommandSchema = z.object({
  options: z.object({
    apiKey: trimmedOptionalStringSchema,
    engine: z.string().trim().min(1, "Engine name is required."),
    json: z.boolean(),
    limit: z.coerce
      .number()
      .int("Limit must be an integer.")
      .positive("Limit must be greater than 0."),
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

const readString = (value: Record<string, unknown>, key: string) => {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
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

export const createBraveSearchEngine = (
  dependencies: BraveSearchEngineDependencies,
) => {
  return {
    name: "brave",
    search: async ({ query, limit }: WebSearchRequest) => {
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
        response = await dependencies.fetchImplementation(url, {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": dependencies.apiKey,
          },
        });
      } catch (error: unknown) {
        throw new WebSearchError(
          error instanceof Error
            ? `Brave search request failed: ${error.message}`
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
  }>,
  registry: WebSearchEngineRegistry,
) => {
  const engine = registry.get(request.engineName);

  if (engine === undefined) {
    throw new WebSearchError(
      `Unknown search engine: ${request.engineName}. Available engines: ${registry.names().join(", ")}`,
    );
  }

  const results = await engine.search({
    query: request.query,
    limit: request.limit,
  });

  if (request.json) {
    return `${JSON.stringify(
      {
        engine: engine.name,
        query: request.query,
        results,
      },
      null,
      2,
    )}\n`;
  }

  if (results.length === 0) {
    return `No results found for "${request.query}" using ${engine.name}.\n`;
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
    .option("--api-key <key>", "Override the API key for the selected engine")
    .action(async (query: string, options: Record<string, unknown>) => {
      const validatedInput = parseSearchCommandInput({ options, query });
      const output = await runWebSearch(
        {
          engineName: validatedInput.options.engine,
          query: validatedInput.query,
          limit: validatedInput.options.limit,
          json: validatedInput.options.json,
        },
        dependencies.createSearchEngineRegistry(validatedInput.options.apiKey),
      );

      dependencies.io.stdout(output);
    });
};
