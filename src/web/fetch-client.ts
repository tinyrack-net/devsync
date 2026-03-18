import { WebPageReadError } from "./read.ts";

export type WebTextRequest = Readonly<{
  accept?: string;
  timeoutMs: number;
  url: string;
}>;

export type WebTextResponse = Readonly<{
  body: string;
  contentType: string;
  finalUrl: string;
  requestedUrl: string;
  status: number;
  statusText: string;
}>;

export type WebFetchClient = Readonly<{
  fetchText: (request: WebTextRequest) => Promise<WebTextResponse>;
}>;

export type FetchWebClientDependencies = Readonly<{
  fetchImplementation: typeof fetch;
  userAgent?: string;
}>;

const createHeaders = (accept?: string, userAgent?: string): Headers => {
  const headers = new Headers();

  if (accept !== undefined && accept !== "") {
    headers.set("Accept", accept);
  }

  if (userAgent !== undefined && userAgent !== "") {
    headers.set("User-Agent", userAgent);
  }

  return headers;
};

export const createFetchWebClient = (
  dependencies: FetchWebClientDependencies,
): WebFetchClient => {
  return {
    fetchText: async (request) => {
      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        abortController.abort();
      }, request.timeoutMs);

      let response: Response;

      try {
        response = await dependencies.fetchImplementation(request.url, {
          headers: createHeaders(request.accept, dependencies.userAgent),
          signal: abortController.signal,
        });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new WebPageReadError(
            `Web request timed out after ${request.timeoutMs}ms.`,
          );
        }

        throw new WebPageReadError(
          error instanceof Error
            ? `Web request failed: ${error.message}`
            : "Web request failed.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new WebPageReadError(
          `Web request failed with ${response.status} ${response.statusText}.`,
        );
      }

      return {
        body: await response.text(),
        contentType: response.headers.get("content-type") ?? "",
        finalUrl: response.url === "" ? request.url : response.url,
        requestedUrl: request.url,
        status: response.status,
        statusText: response.statusText,
      };
    },
  };
};
