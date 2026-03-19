export const defaultWebRequestTimeoutMs = "10000";

export const createRequestHeaders = (
  accept: string,
  userAgent?: string,
): Headers => {
  const headers = new Headers({
    Accept: accept,
  });

  if (userAgent !== undefined && userAgent !== "") {
    headers.set("User-Agent", userAgent);
  }

  return headers;
};

export const fetchWithTimeout = async (request: {
  url: string | URL;
  timeoutMs: number;
  subject: string;
  fetchImplementation: typeof fetch;
  headers?: HeadersInit;
  init?: Omit<RequestInit, "headers" | "signal">;
}) => {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, request.timeoutMs);

  try {
    const init: RequestInit = {
      ...request.init,
      signal: abortController.signal,
    };

    if (request.headers !== undefined) {
      init.headers = request.headers;
    }

    return await request.fetchImplementation(request.url, init);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `${request.subject} timed out after ${request.timeoutMs}ms.`,
      );
    }

    throw new Error(
      error instanceof Error
        ? `${request.subject} failed: ${error.message}`
        : `${request.subject} failed.`,
    );
  } finally {
    clearTimeout(timeout);
  }
};

export const requireContentType = (
  response: Response,
  allowedContentTypeParts: readonly string[],
) => {
  const contentType = response.headers.get("content-type") ?? "";

  if (
    !allowedContentTypeParts.some((allowedContentTypePart) => {
      return contentType.includes(allowedContentTypePart);
    })
  ) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}.`);
  }

  return contentType;
};
