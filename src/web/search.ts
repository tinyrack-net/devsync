export type WebSearchRequest = Readonly<{
  query: string;
  limit: number;
}>;

export type WebSearchResult = Readonly<{
  title: string;
  url: string;
  description: string | undefined;
}>;

export type WebSearchEngine = Readonly<{
  name: string;
  search: (request: WebSearchRequest) => Promise<readonly WebSearchResult[]>;
}>;

export type WebSearchEngineRegistry = Readonly<{
  defaultEngineName: string;
  get: (name: string) => WebSearchEngine | undefined;
  names: () => readonly string[];
}>;

export type RunWebSearchRequest = Readonly<{
  engineName: string;
  query: string;
  limit: number;
  json: boolean;
}>;

export class WebSearchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebSearchError";
  }
}

export const createSearchEngineRegistry = (
  defaultEngineName: string,
  engines: readonly WebSearchEngine[],
): WebSearchEngineRegistry => {
  const engineMap = new Map<string, WebSearchEngine>();

  for (const engine of engines) {
    engineMap.set(engine.name, engine);
  }

  if (!engineMap.has(defaultEngineName)) {
    throw new Error(`Unknown default search engine: ${defaultEngineName}`);
  }

  return {
    defaultEngineName,
    get: (name) => {
      return engineMap.get(name);
    },
    names: () => {
      return [...engineMap.keys()].sort();
    },
  };
};

const formatWebSearchResultsAsText = (
  engineName: string,
  query: string,
  results: readonly WebSearchResult[],
): string => {
  if (results.length === 0) {
    return `No results found for \"${query}\" using ${engineName}.\n`;
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

const formatWebSearchResultsAsJson = (
  engineName: string,
  query: string,
  results: readonly WebSearchResult[],
): string => {
  return `${JSON.stringify(
    {
      engine: engineName,
      query,
      results,
    },
    null,
    2,
  )}\n`;
};

export const runWebSearch = async (
  request: RunWebSearchRequest,
  registry: WebSearchEngineRegistry,
): Promise<string> => {
  const engine = registry.get(request.engineName);

  if (engine === undefined) {
    const availableEngines = registry.names().join(", ");

    throw new WebSearchError(
      `Unknown search engine: ${request.engineName}. Available engines: ${availableEngines}`,
    );
  }

  const results = await engine.search({
    query: request.query,
    limit: request.limit,
  });

  if (request.json) {
    return formatWebSearchResultsAsJson(engine.name, request.query, results);
  }

  return formatWebSearchResultsAsText(engine.name, request.query, results);
};
