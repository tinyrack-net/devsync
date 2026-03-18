import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

import type { WebFetchClient } from "./fetch-client.ts";
import {
  type WebPageContent,
  WebPageReadError,
  type WebPageReadRequest,
} from "./read.ts";

export const webPageMetadataOutputFormats = ["json", "text"] as const;
export const webPageLinksOutputFormats = ["json", "markdown", "text"] as const;
export const webPageExtractOutputFormats = [
  "html",
  "json",
  "markdown",
  "text",
] as const;
export const webPageCodeOutputFormats = ["json", "markdown", "text"] as const;
export const webPageTableOutputFormats = [
  "html",
  "json",
  "markdown",
  "text",
] as const;

export type WebPageMetadataOutputFormat =
  (typeof webPageMetadataOutputFormats)[number];
export type WebPageLinksOutputFormat =
  (typeof webPageLinksOutputFormats)[number];
export type WebPageExtractOutputFormat =
  (typeof webPageExtractOutputFormats)[number];
export type WebPageCodeOutputFormat = (typeof webPageCodeOutputFormats)[number];
export type WebPageTableOutputFormat =
  (typeof webPageTableOutputFormats)[number];

export type WebPageMetadata = Readonly<{
  byline: string | undefined;
  canonicalUrl: string | undefined;
  description: string | undefined;
  excerpt: string | undefined;
  finalUrl: string;
  lang: string | undefined;
  openGraph: Readonly<Record<string, string>>;
  requestedUrl: string;
  siteName: string | undefined;
  title: string | undefined;
  twitter: Readonly<Record<string, string>>;
}>;

export type WebPageLink = Readonly<{
  internal: boolean;
  rel: readonly string[];
  text: string | undefined;
  url: string;
}>;

export type WebPageLinksResult = Readonly<{
  finalUrl: string;
  links: readonly WebPageLink[];
  requestedUrl: string;
}>;

export type WebPageExtractMatch = Readonly<{
  html: string;
  markdown: string;
  selector: string;
  text: string;
}>;

export type WebPageExtractResult = Readonly<{
  finalUrl: string;
  matches: readonly WebPageExtractMatch[];
  requestedUrl: string;
  selector: string;
}>;

export type WebPageCodeBlock = Readonly<{
  code: string;
  html: string;
  language: string | undefined;
}>;

export type WebPageCodeBlocksResult = Readonly<{
  blocks: readonly WebPageCodeBlock[];
  finalUrl: string;
  requestedUrl: string;
}>;

export type WebPageTable = Readonly<{
  caption: string | undefined;
  headers: readonly string[];
  html: string;
  markdown: string;
  rows: readonly (readonly string[])[];
}>;

export type WebPageTablesResult = Readonly<{
  finalUrl: string;
  requestedUrl: string;
  tables: readonly WebPageTable[];
}>;

export type WebPageLinksRequest = Readonly<{
  externalOnly: boolean;
  internalOnly: boolean;
  timeoutMs: number;
  unique: boolean;
  url: string;
}>;

export type WebPageExtractRequest = Readonly<{
  all: boolean;
  selector: string;
  timeoutMs: number;
  url: string;
}>;

export type WebPageCodeBlocksRequest = Readonly<{
  language: string | undefined;
  timeoutMs: number;
  url: string;
}>;

export type WebPageTablesRequest = Readonly<{
  timeoutMs: number;
  url: string;
}>;

export type WebDocumentLoader = Readonly<{
  load: (request: WebPageReadRequest) => Promise<LoadedHtmlDocument>;
}>;

export type WebPageInspector = Readonly<{
  code: (request: WebPageCodeBlocksRequest) => Promise<WebPageCodeBlocksResult>;
  extract: (request: WebPageExtractRequest) => Promise<WebPageExtractResult>;
  links: (request: WebPageLinksRequest) => Promise<WebPageLinksResult>;
  meta: (request: WebPageReadRequest) => Promise<WebPageMetadata>;
  tables: (request: WebPageTablesRequest) => Promise<WebPageTablesResult>;
}>;

type LoadedHtmlDocument = Readonly<{
  dom: JSDOM;
  finalUrl: string;
  html: string;
  requestedUrl: string;
}>;

type ReadabilityArticle = NonNullable<ReturnType<Readability["parse"]>>;

const normalizeText = (value: string): string => {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const normalizeCode = (value: string): string => {
  return value.replace(/\r\n/g, "\n").trim();
};

const trimToUndefined = (
  value: string | null | undefined,
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === "" ? undefined : trimmedValue;
};

const toMarkdown = (html: string): string => {
  const turndownService = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });

  return normalizeText(turndownService.turndown(html));
};

const ensureTrailingNewline = (value: string): string => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

const toAbsoluteHttpUrl = (
  value: string,
  baseUrl: string,
): string | undefined => {
  try {
    const url = new URL(value, baseUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
};

const getReadabilityArticle = (
  document: Document,
): ReadabilityArticle | undefined => {
  return new Readability(document).parse() ?? undefined;
};

const getMetaContent = (
  document: Document,
  attribute: "name" | "property",
  value: string,
): string | undefined => {
  const metaElement = document.querySelector(`meta[${attribute}="${value}"]`);

  return trimToUndefined(metaElement?.getAttribute("content"));
};

const collectMetaByPrefix = (
  document: Document,
  attribute: "name" | "property",
  prefix: string,
): Readonly<Record<string, string>> => {
  const entries: Array<readonly [string, string]> = [];

  for (const element of document.querySelectorAll(`meta[${attribute}]`)) {
    const key = trimToUndefined(element.getAttribute(attribute));
    const content = trimToUndefined(element.getAttribute("content"));

    if (key === undefined || content === undefined || !key.startsWith(prefix)) {
      continue;
    }

    entries.push([key.slice(prefix.length), content]);
  }

  return Object.freeze(Object.fromEntries(entries));
};

const formatKeyValueLines = (
  entries: readonly (readonly [string, string | undefined])[],
): string => {
  return entries
    .filter(([, value]) => {
      return value !== undefined;
    })
    .map(([key, value]) => {
      return `${key}: ${value}`;
    })
    .join("\n");
};

const createTableMarkdown = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string => {
  const normalizedHeaders = headers.map((header) => {
    return header === "" ? "-" : header;
  });
  const headerLine = `| ${normalizedHeaders.join(" | ")} |`;
  const separatorLine = `| ${normalizedHeaders.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => {
    return `| ${row.join(" | ")} |`;
  });

  return [headerLine, separatorLine, ...rowLines].join("\n");
};

const detectCodeLanguage = (element: Element): string | undefined => {
  for (const className of element.classList) {
    const match = /(?:lang|language)-([a-z0-9+#.-]+)/i.exec(className);

    if (match?.[1] !== undefined) {
      return match[1].toLowerCase();
    }
  }

  return undefined;
};

const createLoadedHtmlDocument = (
  requestedUrl: string,
  finalUrl: string,
  html: string,
): LoadedHtmlDocument => {
  return {
    dom: new JSDOM(html, { url: finalUrl }),
    finalUrl,
    html,
    requestedUrl,
  };
};

const extractFallbackContent = (document: Document) => {
  const body = document.body;

  return {
    byline: undefined,
    excerpt: undefined,
    html: body.innerHTML.trim(),
    siteName: undefined,
    text: normalizeText(body.textContent ?? ""),
    title: trimToUndefined(document.title),
  };
};

export const extractWebPageContent = (
  loadedDocument: LoadedHtmlDocument,
): WebPageContent => {
  const readabilityArticle = getReadabilityArticle(
    loadedDocument.dom.window.document,
  );
  const fallbackContent = extractFallbackContent(
    loadedDocument.dom.window.document,
  );
  const html =
    trimToUndefined(readabilityArticle?.content) ?? fallbackContent.html;
  const text = normalizeText(
    readabilityArticle?.textContent ?? fallbackContent.text,
  );

  return {
    requestedUrl: loadedDocument.requestedUrl,
    finalUrl: loadedDocument.finalUrl,
    title: trimToUndefined(readabilityArticle?.title) ?? fallbackContent.title,
    excerpt:
      trimToUndefined(readabilityArticle?.excerpt) ?? fallbackContent.excerpt,
    byline:
      trimToUndefined(readabilityArticle?.byline) ?? fallbackContent.byline,
    siteName:
      trimToUndefined(readabilityArticle?.siteName) ?? fallbackContent.siteName,
    text,
    html,
    markdown: toMarkdown(html),
  };
};

export const extractWebPageMetadata = (
  loadedDocument: LoadedHtmlDocument,
): WebPageMetadata => {
  const document = loadedDocument.dom.window.document;
  const readabilityArticle = getReadabilityArticle(document);
  const canonicalUrl = trimToUndefined(
    document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
  );

  return {
    requestedUrl: loadedDocument.requestedUrl,
    finalUrl: loadedDocument.finalUrl,
    title:
      trimToUndefined(document.title) ??
      trimToUndefined(readabilityArticle?.title),
    description:
      getMetaContent(document, "name", "description") ??
      getMetaContent(document, "property", "og:description"),
    canonicalUrl:
      canonicalUrl === undefined
        ? undefined
        : toAbsoluteHttpUrl(canonicalUrl, loadedDocument.finalUrl),
    excerpt: trimToUndefined(readabilityArticle?.excerpt),
    byline: trimToUndefined(readabilityArticle?.byline),
    siteName:
      trimToUndefined(readabilityArticle?.siteName) ??
      getMetaContent(document, "property", "og:site_name"),
    lang: trimToUndefined(document.documentElement.lang),
    openGraph: collectMetaByPrefix(document, "property", "og:"),
    twitter: collectMetaByPrefix(document, "name", "twitter:"),
  };
};

export const extractWebPageLinks = (
  loadedDocument: LoadedHtmlDocument,
  request: Pick<
    WebPageLinksRequest,
    "externalOnly" | "internalOnly" | "unique"
  >,
): WebPageLinksResult => {
  const links: WebPageLink[] = [];
  const seenUrls = new Set<string>();
  const finalUrlObject = new URL(loadedDocument.finalUrl);

  for (const element of loadedDocument.dom.window.document.querySelectorAll(
    "a[href]",
  )) {
    const href = trimToUndefined(element.getAttribute("href"));

    if (href === undefined) {
      continue;
    }

    const url = toAbsoluteHttpUrl(href, loadedDocument.finalUrl);

    if (url === undefined) {
      continue;
    }

    if (request.unique && seenUrls.has(url)) {
      continue;
    }

    const internal = new URL(url).origin === finalUrlObject.origin;

    if (request.internalOnly && !internal) {
      continue;
    }

    if (request.externalOnly && internal) {
      continue;
    }

    seenUrls.add(url);
    links.push({
      internal,
      rel: trimToUndefined(element.getAttribute("rel"))?.split(/\s+/u) ?? [],
      text: trimToUndefined(normalizeText(element.textContent ?? "")),
      url,
    });
  }

  return {
    requestedUrl: loadedDocument.requestedUrl,
    finalUrl: loadedDocument.finalUrl,
    links,
  };
};

export const extractWebPageMatches = (
  loadedDocument: LoadedHtmlDocument,
  request: Pick<WebPageExtractRequest, "all" | "selector">,
): WebPageExtractResult => {
  let elements: Element[];

  try {
    elements = [
      ...loadedDocument.dom.window.document.querySelectorAll(request.selector),
    ];
  } catch {
    throw new WebPageReadError(`Invalid selector: ${request.selector}`);
  }

  if (elements.length === 0) {
    throw new WebPageReadError(
      `No elements matched selector: ${request.selector}`,
    );
  }

  const selectedElements = request.all ? elements : elements.slice(0, 1);

  return {
    requestedUrl: loadedDocument.requestedUrl,
    finalUrl: loadedDocument.finalUrl,
    selector: request.selector,
    matches: selectedElements.map((element) => {
      const html = element.outerHTML.trim();

      return {
        selector: request.selector,
        text: normalizeText(element.textContent ?? ""),
        html,
        markdown: toMarkdown(html),
      };
    }),
  };
};

export const extractWebPageCodeBlocks = (
  loadedDocument: LoadedHtmlDocument,
  request: Pick<WebPageCodeBlocksRequest, "language">,
): WebPageCodeBlocksResult => {
  const blocks: WebPageCodeBlock[] = [];

  for (const element of loadedDocument.dom.window.document.querySelectorAll(
    "pre, code",
  )) {
    if (
      element.tagName === "CODE" &&
      element.parentElement?.tagName === "PRE"
    ) {
      continue;
    }

    const codeElement =
      element.tagName === "PRE"
        ? (element.querySelector("code") ?? element)
        : element;
    const language =
      detectCodeLanguage(codeElement) ?? detectCodeLanguage(element);

    if (
      request.language !== undefined &&
      language !== undefined &&
      language !== request.language.toLowerCase()
    ) {
      continue;
    }

    if (request.language !== undefined && language === undefined) {
      continue;
    }

    const code = normalizeCode(codeElement.textContent ?? "");

    if (code === "") {
      continue;
    }

    blocks.push({
      code,
      html: element.outerHTML.trim(),
      language,
    });
  }

  return {
    requestedUrl: loadedDocument.requestedUrl,
    finalUrl: loadedDocument.finalUrl,
    blocks,
  };
};

export const extractWebPageTables = (
  loadedDocument: LoadedHtmlDocument,
): WebPageTablesResult => {
  const tables: WebPageTable[] = [];

  for (const tableElement of loadedDocument.dom.window.document.querySelectorAll(
    "table",
  )) {
    const rawRows = [...tableElement.querySelectorAll("tr")].map((row) => {
      return [...row.querySelectorAll("th, td")].map((cell) => {
        return normalizeText(cell.textContent ?? "");
      });
    });

    const nonEmptyRows = rawRows.filter((row) => {
      return row.length > 0;
    });

    if (nonEmptyRows.length === 0) {
      continue;
    }

    const headerCandidates = [
      ...tableElement.querySelectorAll("thead tr th"),
    ].map((cell) => {
      return normalizeText(cell.textContent ?? "");
    });
    const headers =
      headerCandidates.length > 0
        ? headerCandidates
        : (nonEmptyRows[0]?.map((_cell, index) => {
            return `column${index + 1}`;
          }) ?? []);
    const bodyRows = [...tableElement.querySelectorAll("tbody tr")].map(
      (row) => {
        return [...row.querySelectorAll("th, td")].map((cell) => {
          return normalizeText(cell.textContent ?? "");
        });
      },
    );
    const rows =
      headerCandidates.length > 0
        ? bodyRows.filter((row) => {
            return row.length > 0;
          })
        : nonEmptyRows.slice(1);

    tables.push({
      caption: trimToUndefined(
        tableElement.querySelector("caption")?.textContent,
      ),
      headers,
      html: tableElement.outerHTML.trim(),
      markdown: createTableMarkdown(headers, rows),
      rows,
    });
  }

  return {
    requestedUrl: loadedDocument.requestedUrl,
    finalUrl: loadedDocument.finalUrl,
    tables,
  };
};

const withLoadedDocument = async <T>(
  loader: WebDocumentLoader,
  request: WebPageReadRequest,
  callback: (loadedDocument: LoadedHtmlDocument) => T,
): Promise<T> => {
  const loadedDocument = await loader.load(request);

  try {
    return callback(loadedDocument);
  } finally {
    loadedDocument.dom.window.close();
  }
};

export const createFetchWebDocumentLoader = (
  fetchClient: WebFetchClient,
): WebDocumentLoader => {
  return {
    load: async (request) => {
      const response = await fetchClient.fetchText({
        accept: "text/html,application/xhtml+xml",
        timeoutMs: request.timeoutMs,
        url: request.url,
      });

      if (
        !response.contentType.includes("text/html") &&
        !response.contentType.includes("application/xhtml+xml")
      ) {
        throw new WebPageReadError(
          `Unsupported content type: ${response.contentType || "unknown"}.`,
        );
      }

      return createLoadedHtmlDocument(
        response.requestedUrl,
        response.finalUrl,
        response.body,
      );
    },
  };
};

export const createFetchWebPageInspector = (
  loader: WebDocumentLoader,
): WebPageInspector => {
  return {
    code: async (request) => {
      return withLoadedDocument(loader, request, (loadedDocument) => {
        return extractWebPageCodeBlocks(loadedDocument, request);
      });
    },
    extract: async (request) => {
      return withLoadedDocument(loader, request, (loadedDocument) => {
        return extractWebPageMatches(loadedDocument, request);
      });
    },
    links: async (request) => {
      return withLoadedDocument(loader, request, (loadedDocument) => {
        return extractWebPageLinks(loadedDocument, request);
      });
    },
    meta: async (request) => {
      return withLoadedDocument(loader, request, (loadedDocument) => {
        return extractWebPageMetadata(loadedDocument);
      });
    },
    tables: async (request) => {
      return withLoadedDocument(loader, request, (loadedDocument) => {
        return extractWebPageTables(loadedDocument);
      });
    },
  };
};

export const formatWebPageMetadata = (
  metadata: WebPageMetadata,
  format: WebPageMetadataOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(metadata, null, 2)}\n`;
    case "text": {
      const baseLines = formatKeyValueLines([
        ["Requested URL", metadata.requestedUrl],
        ["Final URL", metadata.finalUrl],
        ["Title", metadata.title],
        ["Description", metadata.description],
        ["Canonical URL", metadata.canonicalUrl],
        ["Lang", metadata.lang],
        ["Site name", metadata.siteName],
        ["Byline", metadata.byline],
        ["Excerpt", metadata.excerpt],
      ]);
      const sections = [baseLines];

      if (Object.keys(metadata.openGraph).length > 0) {
        sections.push(
          [
            "Open Graph:",
            formatKeyValueLines(Object.entries(metadata.openGraph)),
          ]
            .filter((section) => {
              return section !== "";
            })
            .join("\n"),
        );
      }

      if (Object.keys(metadata.twitter).length > 0) {
        sections.push(
          ["Twitter:", formatKeyValueLines(Object.entries(metadata.twitter))]
            .filter((section) => {
              return section !== "";
            })
            .join("\n"),
        );
      }

      return ensureTrailingNewline(
        sections
          .filter((section) => {
            return section !== "";
          })
          .join("\n\n"),
      );
    }
  }
};

export const formatWebPageLinks = (
  result: WebPageLinksResult,
  format: WebPageLinksOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "markdown":
      return ensureTrailingNewline(
        result.links
          .map((link) => {
            const text = link.text ?? link.url;

            return `- [${text}](${link.url})`;
          })
          .join("\n"),
      );
    case "text":
      return ensureTrailingNewline(
        result.links
          .map((link) => {
            return `${link.internal ? "internal" : "external"}\t${link.url}\t${link.text ?? ""}`.trimEnd();
          })
          .join("\n"),
      );
  }
};

export const formatWebPageExtract = (
  result: WebPageExtractResult,
  format: WebPageExtractOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "html":
      return ensureTrailingNewline(
        result.matches
          .map((match) => {
            return match.html;
          })
          .join("\n\n"),
      );
    case "markdown":
      return ensureTrailingNewline(
        result.matches
          .map((match) => {
            return match.markdown;
          })
          .join("\n\n---\n\n"),
      );
    case "text":
      return ensureTrailingNewline(
        result.matches
          .map((match) => {
            return match.text;
          })
          .join("\n\n---\n\n"),
      );
  }
};

export const formatWebPageCodeBlocks = (
  result: WebPageCodeBlocksResult,
  format: WebPageCodeOutputFormat,
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "markdown":
      return ensureTrailingNewline(
        result.blocks
          .map((block) => {
            const language = block.language ?? "text";

            return `\`\`\`${language}\n${block.code}\n\`\`\``;
          })
          .join("\n\n"),
      );
    case "text":
      return ensureTrailingNewline(
        result.blocks
          .map((block) => {
            return block.code;
          })
          .join("\n\n---\n\n"),
      );
  }
};

export const formatWebPageTables = (
  result: WebPageTablesResult,
  format: WebPageTableOutputFormat,
): string => {
  switch (format) {
    case "html":
      return ensureTrailingNewline(
        result.tables
          .map((table) => {
            return table.html;
          })
          .join("\n\n"),
      );
    case "json":
      return `${JSON.stringify(result, null, 2)}\n`;
    case "markdown":
      return ensureTrailingNewline(
        result.tables
          .map((table) => {
            return table.caption === undefined
              ? table.markdown
              : `${table.caption}\n\n${table.markdown}`;
          })
          .join("\n\n"),
      );
    case "text":
      return ensureTrailingNewline(
        result.tables
          .map((table) => {
            const rows = [table.headers, ...table.rows];

            return rows
              .map((row) => {
                return row.join("\t");
              })
              .join("\n");
          })
          .join("\n\n"),
      );
  }
};
