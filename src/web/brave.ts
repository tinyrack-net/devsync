import {
  type WebSearchEngine,
  WebSearchError,
  type WebSearchResult,
} from "./search.ts";

export type BraveSearchEngineDependencies = Readonly<{
  apiKey: string | undefined;
  fetchImplementation: typeof fetch;
  baseUrl?: string;
}>;

type JsonObject = Record<string, unknown>;

type BraveSearchResponse = Readonly<{
  web?: unknown;
}>;

type BraveWebSection = Readonly<{
  results?: unknown;
}>;

const isJsonObject = (value: unknown): value is JsonObject => {
  return typeof value === "object" && value !== null;
};

const readString = (value: JsonObject, key: string): string | undefined => {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

const readResults = (value: unknown): readonly WebSearchResult[] => {
  if (!isJsonObject(value)) {
    return [];
  }

  const response = value as BraveSearchResponse;
  const web = response.web;

  if (!isJsonObject(web)) {
    return [];
  }

  const webSection = web as BraveWebSection;
  const results = webSection.results;

  if (!Array.isArray(results)) {
    return [];
  }

  const parsedResults: WebSearchResult[] = [];

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
): WebSearchEngine => {
  return {
    name: "brave",
    search: async ({ query, limit }) => {
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

      const responseBody: unknown = await response.json();

      return readResults(responseBody);
    },
  };
};
