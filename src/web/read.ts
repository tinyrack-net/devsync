export const webPageOutputFormats = [
  "markdown",
  "text",
  "html",
  "json",
] as const;

export type WebPageOutputFormat = (typeof webPageOutputFormats)[number];

export type WebPageReadRequest = Readonly<{
  url: string;
  timeoutMs: number;
}>;

export type WebPageContent = Readonly<{
  requestedUrl: string;
  finalUrl: string;
  title: string | undefined;
  excerpt: string | undefined;
  byline: string | undefined;
  siteName: string | undefined;
  text: string;
  html: string;
  markdown: string;
}>;

export type WebPageReader = Readonly<{
  read: (request: WebPageReadRequest) => Promise<WebPageContent>;
}>;

export class WebPageReadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WebPageReadError";
  }
}

const ensureTrailingNewline = (value: string): string => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

export const formatWebPageContent = (
  content: WebPageContent,
  format: WebPageOutputFormat,
): string => {
  switch (format) {
    case "markdown":
      return ensureTrailingNewline(content.markdown);
    case "text":
      return ensureTrailingNewline(content.text);
    case "html":
      return ensureTrailingNewline(content.html);
    case "json":
      return `${JSON.stringify(content, null, 2)}\n`;
  }
};
