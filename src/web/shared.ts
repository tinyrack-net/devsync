import { z } from "zod";

export const defaultWebRequestTimeoutMs = "10000";

export const trimmedOptionalStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    return value === undefined || value === "" ? undefined : value;
  });

export const absoluteHttpUrlSchema = z
  .string()
  .trim()
  .superRefine((value, context) => {
    try {
      const parsedUrl = new URL(value);

      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        return;
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "URL must be a valid absolute URL.",
      });

      return;
    }

    context.addIssue({
      code: "custom",
      message: "URL must use http or https.",
    });
  });

export const formatInputIssues = (issues: z.ZodIssue[]): string => {
  return issues
    .map((issue) => {
      const path = issue.path.length === 0 ? "input" : issue.path.join(".");

      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
};

export const normalizeWhitespace = (value: string): string => {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const ensureTrailingNewline = (value: string) => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

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

export const readOptionalString = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === "" ? undefined : trimmedValue;
};

export const readString = (value: Record<string, unknown>, key: string) => {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

export const isJsonObject = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const normalizeAbsoluteUrl = (
  value: string,
  options?: Readonly<{
    keepHash?: boolean;
  }>,
) => {
  const url = new URL(value);

  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  if (options?.keepHash !== true) {
    url.hash = "";
  }

  return url.toString();
};

export const isSameOriginUrl = (targetUrl: string, baseUrl: string) => {
  return new URL(targetUrl).origin === new URL(baseUrl).origin;
};

export const normalizeSearchSite = (value: string) => {
  const trimmedValue = value.trim();

  if (trimmedValue === "") {
    throw new Error("Site must not be empty.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = trimmedValue.includes("://")
      ? new URL(trimmedValue)
      : new URL(`https://${trimmedValue}`);
  } catch {
    throw new Error("Site must be a valid hostname or absolute URL.");
  }

  const normalizedPath =
    parsedUrl.pathname === "/" ? "" : parsedUrl.pathname.replace(/\/+$/u, "");

  return `${parsedUrl.host.toLowerCase()}${normalizedPath}`;
};

export const splitTokens = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(/\s+/u)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
};
