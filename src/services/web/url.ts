import { z } from "zod";

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
