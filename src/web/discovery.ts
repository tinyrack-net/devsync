import {
  type WebDocumentLoader,
  extractWebPageLinks,
  extractWebPageMetadata,
} from "./document.ts";
import type { WebFetchClient } from "./fetch-client.ts";
import { WebPageReadError, type WebPageReadRequest } from "./read.ts";

export const webRobotsOutputFormats = ["json", "text"] as const;
export const webSitemapOutputFormats = ["json", "text"] as const;
export const webCrawlOutputFormats = ["json", "text"] as const;

export type WebRobotsOutputFormat = (typeof webRobotsOutputFormats)[number];
export type WebSitemapOutputFormat = (typeof webSitemapOutputFormats)[number];
export type WebCrawlOutputFormat = (typeof webCrawlOutputFormats)[number];

export type WebRobotsGroup = Readonly<{
  allow: readonly string[];
  crawlDelay: number | undefined;
  disallow: readonly string[];
  userAgents: readonly string[];
}>;

export type WebRobotsResult = Readonly<{
  finalUrl: string;
  groups: readonly WebRobotsGroup[];
  requestedUrl: string;
  robotsUrl: string;
  sitemaps: readonly string[];
  text: string;
}>;

export type WebSitemapResult = Readonly<{
  finalUrl: string;
  requestedUrl: string;
  sitemapUrl: string;
  sitemaps: readonly string[];
  urls: readonly string[];
  xml: string;
}>;

export type WebCrawlPage = Readonly<{
  depth: number;
  description: string | undefined;
  finalUrl: string;
  requestedUrl: string;
  title: string | undefined;
}>;

export type WebCrawlRequest = Readonly<{
  exclude: string | undefined;
  include: string | undefined;
  maxDepth: number;
  maxPages: number;
  sameOrigin: boolean;
  timeoutMs: number;
  url: string;
}>;

export type WebCrawlResult = Readonly<{
  pages: readonly WebCrawlPage[];
  rootUrl: string;
  settings: Readonly<{
    exclude: string | undefined;
    include: string | undefined;
    maxDepth: number;
    maxPages: number;
    sameOrigin: boolean;
  }>;
}>;

export type WebDiscoveryService = Readonly<{
  crawl: (request: WebCrawlRequest) => Promise<WebCrawlResult>;
  robots: (request: WebPageReadRequest) => Promise<WebRobotsResult>;
  sitemap: (request: WebPageReadRequest) => Promise<WebSitemapResult>;
}>;

const ensureTrailingNewline = (value: string): string => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

const normalizeWhitespace = (value: string): string => {
  return value.replace(/\r\n/g, "\n").trim();
};

const resolveRobotsUrl = (url: string): string => {
  return new URL("/robots.txt", url).toString();
};

const resolveSitemapUrl = (url: string): string => {
  const parsedUrl = new URL(url);

  return parsedUrl.pathname.endsWith(".xml")
    ? parsedUrl.toString()
    : new URL("/sitemap.xml", url).toString();
};

const decodeXmlEntities = (value: string): string => {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
};

const parseRobotsText = (
  text: string,
): Omit<WebRobotsResult, "finalUrl" | "requestedUrl" | "robotsUrl"> => {
  const groups: WebRobotsGroup[] = [];
  const sitemaps: string[] = [];
  let currentGroup:
    | {
        allow: string[];
        crawlDelay: number | undefined;
        disallow: string[];
        userAgents: string[];
      }
    | undefined;

  for (const rawLine of text.split(/\r?\n/u)) {
    const lineWithoutComment = rawLine.replace(/#.*$/u, "").trim();

    if (lineWithoutComment === "") {
      currentGroup = undefined;
      continue;
    }

    const separatorIndex = lineWithoutComment.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = lineWithoutComment
      .slice(0, separatorIndex)
      .trim()
      .toLowerCase();
    const value = lineWithoutComment.slice(separatorIndex + 1).trim();

    switch (key) {
      case "user-agent": {
        if (currentGroup === undefined) {
          currentGroup = {
            allow: [],
            crawlDelay: undefined,
            disallow: [],
            userAgents: [],
          };
          groups.push(currentGroup);
        }

        currentGroup.userAgents.push(value);
        break;
      }
      case "allow": {
        if (currentGroup !== undefined) {
          currentGroup.allow.push(value);
        }
        break;
      }
      case "disallow": {
        if (currentGroup !== undefined) {
          currentGroup.disallow.push(value);
        }
        break;
      }
      case "crawl-delay": {
        if (currentGroup !== undefined) {
          const crawlDelay = Number(value);

          if (!Number.isNaN(crawlDelay)) {
            currentGroup.crawlDelay = crawlDelay;
          }
        }
        break;
      }
      case "sitemap":
        sitemaps.push(value);
        break;
      default:
        break;
    }
  }

  return {
    groups,
    sitemaps,
    text,
  };
};

const parseSitemapXml = (
  xml: string,
): Omit<WebSitemapResult, "finalUrl" | "requestedUrl" | "sitemapUrl"> => {
  const locMatches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gisu)]
    .map((match) => {
      return decodeXmlEntities(match[1] ?? "").trim();
    })
    .filter((value) => {
      return value !== "";
    });
  const isSitemapIndex = /<sitemapindex\b/iu.test(xml);

  return isSitemapIndex
    ? { sitemaps: locMatches, urls: [], xml }
    : { sitemaps: [], urls: locMatches, xml };
};

const normalizeCrawlUrl = (url: string): string => {
  return new URL(url).toString();
};

const shouldSkipCrawlUrl = (
  url: string,
  rootOrigin: string,
  request: Pick<WebCrawlRequest, "exclude" | "include" | "sameOrigin">,
): boolean => {
  if (request.sameOrigin && new URL(url).origin !== rootOrigin) {
    return true;
  }

  if (request.include !== undefined && !url.includes(request.include)) {
    return true;
  }

  if (request.exclude !== undefined && url.includes(request.exclude)) {
    return true;
  }

  return false;
};

export const createWebDiscoveryService = (
  fetchClient: WebFetchClient,
  documentLoader: WebDocumentLoader,
): WebDiscoveryService => {
  return {
    crawl: async (request) => {
      const normalizedRootUrl = normalizeCrawlUrl(request.url);
      const rootOrigin = new URL(normalizedRootUrl).origin;
      const pages: WebCrawlPage[] = [];
      const queue: Array<Readonly<{ depth: number; url: string }>> = [
        {
          depth: 0,
          url: normalizedRootUrl,
        },
      ];
      const seenUrls = new Set<string>();

      while (queue.length > 0 && pages.length < request.maxPages) {
        const nextEntry = queue.shift();

        if (nextEntry === undefined) {
          continue;
        }

        const normalizedEntryUrl = normalizeCrawlUrl(nextEntry.url);

        if (seenUrls.has(normalizedEntryUrl)) {
          continue;
        }

        seenUrls.add(normalizedEntryUrl);

        const loadedDocument = await documentLoader.load({
          timeoutMs: request.timeoutMs,
          url: normalizedEntryUrl,
        });

        try {
          const metadata = extractWebPageMetadata(loadedDocument);
          const linksResult = extractWebPageLinks(loadedDocument, {
            externalOnly: false,
            internalOnly: false,
            unique: true,
          });

          pages.push({
            depth: nextEntry.depth,
            description: metadata.description,
            finalUrl: metadata.finalUrl,
            requestedUrl: metadata.requestedUrl,
            title: metadata.title,
          });

          if (nextEntry.depth >= request.maxDepth) {
            continue;
          }

          for (const link of linksResult.links) {
            const normalizedLinkUrl = normalizeCrawlUrl(link.url);

            if (seenUrls.has(normalizedLinkUrl)) {
              continue;
            }

            if (shouldSkipCrawlUrl(normalizedLinkUrl, rootOrigin, request)) {
              continue;
            }

            queue.push({
              depth: nextEntry.depth + 1,
              url: normalizedLinkUrl,
            });
          }
        } finally {
          loadedDocument.dom.window.close();
        }
      }

      return {
        rootUrl: request.url,
        settings: {
          exclude: request.exclude,
          include: request.include,
          maxDepth: request.maxDepth,
          maxPages: request.maxPages,
          sameOrigin: request.sameOrigin,
        },
        pages,
      };
    },
    robots: async (request) => {
      const robotsUrl = resolveRobotsUrl(request.url);
      const response = await fetchClient.fetchText({
        accept: "text/plain, text/*, */*",
        timeoutMs: request.timeoutMs,
        url: robotsUrl,
      });
      const parsed = parseRobotsText(normalizeWhitespace(response.body));

      return {
        requestedUrl: request.url,
        finalUrl: response.finalUrl,
        robotsUrl,
        ...parsed,
      };
    },
    sitemap: async (request) => {
      const sitemapUrl = resolveSitemapUrl(request.url);
      const response = await fetchClient.fetchText({
        accept: "application/xml, text/xml, */*",
        timeoutMs: request.timeoutMs,
        url: sitemapUrl,
      });

      if (
        !response.contentType.includes("xml") &&
        !response.contentType.includes("text/plain") &&
        response.contentType !== ""
      ) {
        throw new WebPageReadError(
          `Unsupported sitemap content type: ${response.contentType}.`,
        );
      }

      const parsed = parseSitemapXml(response.body);

      return {
        requestedUrl: request.url,
        finalUrl: response.finalUrl,
        sitemapUrl,
        ...parsed,
      };
    },
  };
};

export const formatWebRobots = (
  result: WebRobotsResult,
  format: WebRobotsOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "text":
      return ensureTrailingNewline(result.text);
  }
};

export const formatWebSitemap = (
  result: WebSitemapResult,
  format: WebSitemapOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "text":
      return ensureTrailingNewline(
        [...result.sitemaps, ...result.urls].join("\n"),
      );
  }
};

export const formatWebCrawl = (
  result: WebCrawlResult,
  format: WebCrawlOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "text":
      return ensureTrailingNewline(
        result.pages
          .map((page) => {
            return `${page.depth}\t${page.finalUrl}\t${page.title ?? ""}`.trimEnd();
          })
          .join("\n"),
      );
  }
};
