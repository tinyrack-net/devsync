import { describe, expect, it, vi } from "vitest";

import {
  createWebPageLinkReader,
  formatWebPageLinks,
  runWebLinksCommand,
  WebPageLinksError,
} from "#app/services/web/links.ts";

type WebPageLinks = Awaited<
  ReturnType<ReturnType<typeof createWebPageLinkReader>["read"]>
>;

const sampleLinks = {
  requestedUrl: "https://example.com/requested",
  finalUrl: "https://example.com/final",
  canonicalUrl: "https://example.com/canonical",
  sameOriginOnly: false,
  links: [
    {
      kind: "same-origin",
      url: "https://example.com/docs",
      texts: ["Docs"],
      rel: [],
      targets: [],
      occurrences: 1,
    },
  ],
} satisfies WebPageLinks;

describe("formatWebPageLinks", () => {
  it("formats text output", () => {
    expect(formatWebPageLinks(sampleLinks, false)).toContain(
      "1. [same-origin] https://example.com/docs",
    );
  });

  it("formats json output", () => {
    expect(JSON.parse(formatWebPageLinks(sampleLinks, true))).toEqual(
      sampleLinks,
    );
  });
});

describe("runWebLinksCommand", () => {
  it("maps validated input to the link reader and formats json output", async () => {
    const requests: Array<{
      url: string;
      timeoutMs: number;
      sameOriginOnly: boolean;
    }> = [];

    const output = await runWebLinksCommand(
      {
        url: "https://example.com/article",
        options: {
          json: true,
          sameOrigin: true,
          timeout: 1_000,
        },
      },
      {
        webPageLinkReader: {
          read: async (request) => {
            requests.push(request);

            return {
              ...sampleLinks,
              finalUrl: request.url,
              requestedUrl: request.url,
              sameOriginOnly: request.sameOriginOnly,
            };
          },
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      finalUrl: "https://example.com/article",
      sameOriginOnly: true,
    });
    expect(requests).toEqual([
      {
        url: "https://example.com/article",
        timeoutMs: 1_000,
        sameOriginOnly: true,
      },
    ]);
  });
});

describe("createWebPageLinkReader", () => {
  it("extracts, normalizes, and groups page links", async () => {
    const reader = createWebPageLinkReader({
      fetchImplementation: vi.fn(async () => {
        return new Response(
          `
            <html>
              <head>
                <link rel="canonical" href="/canonical" />
              </head>
              <body>
                <a href="../guide">Guide</a>
                <a href="./intro?lang=en#install">Intro</a>
                <a href="?tab=api">API tab</a>
                <a href="/docs#alpha">Docs alpha</a>
                <a href="/docs#beta">Docs beta</a>
                <a href="#top">Back to top</a>
                <a href="//example.com/shared#fragment">Shared</a>
                <a href="https://external.example.com/path" rel="noopener nofollow" target="_blank">External A</a>
                <a href="https://external.example.com/path" rel="nofollow" target="_self">External B</a>
                <a href="/icon"><span aria-hidden="true"></span></a>
                <a href="/aria" aria-label="ARIA label"><span></span></a>
                <a href="/title" title="Title label"><span>   </span></a>
                <a href="mailto:test@example.com">Mail</a>
                <a href="tel:+123">Phone</a>
                <a href="data:text/plain,hello">Data</a>
                <a href="javascript:void(0)">JavaScript</a>
              </body>
            </html>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          },
        );
      }),
    });

    const links = await reader.read({
      url: "https://example.com/docs/reference/page?version=1#details",
      timeoutMs: 1_000,
      sameOriginOnly: false,
    });

    expect(links).toEqual({
      requestedUrl: "https://example.com/docs/reference/page?version=1#details",
      finalUrl: "https://example.com/docs/reference/page?version=1#details",
      canonicalUrl: "https://example.com/canonical",
      sameOriginOnly: false,
      links: [
        {
          kind: "same-origin",
          url: "https://example.com/aria",
          texts: ["ARIA label"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "same-origin",
          url: "https://example.com/docs",
          texts: ["Docs alpha", "Docs beta"],
          rel: [],
          targets: [],
          occurrences: 2,
        },
        {
          kind: "same-origin",
          url: "https://example.com/docs/guide",
          texts: ["Guide"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "same-origin",
          url: "https://example.com/docs/reference/intro?lang=en",
          texts: ["Intro"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "same-origin",
          url: "https://example.com/docs/reference/page?tab=api",
          texts: ["API tab"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "same-origin",
          url: "https://example.com/icon",
          texts: [],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "same-origin",
          url: "https://example.com/shared",
          texts: ["Shared"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "same-origin",
          url: "https://example.com/title",
          texts: ["Title label"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "fragment",
          url: "https://example.com/docs/reference/page?version=1#top",
          texts: ["Back to top"],
          rel: [],
          targets: [],
          occurrences: 1,
        },
        {
          kind: "external",
          url: "https://external.example.com/path",
          texts: ["External A", "External B"],
          rel: ["nofollow", "noopener"],
          targets: ["_blank", "_self"],
          occurrences: 2,
        },
      ],
    });
  });

  it("supports same-origin filtering while keeping fragments", async () => {
    const reader = createWebPageLinkReader({
      fetchImplementation: vi.fn(async () => {
        return new Response(
          "<html><body><a href='/docs'>Docs</a><a href='#top'>Top</a><a href='https://external.example.com/path'>External</a></body></html>",
          {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          },
        );
      }),
    });

    const links = await reader.read({
      url: "https://example.com/article",
      timeoutMs: 1_000,
      sameOriginOnly: true,
    });

    expect(links.links).toEqual([
      {
        kind: "same-origin",
        url: "https://example.com/docs",
        texts: ["Docs"],
        rel: [],
        targets: [],
        occurrences: 1,
      },
      {
        kind: "fragment",
        url: "https://example.com/article#top",
        texts: ["Top"],
        rel: [],
        targets: [],
        occurrences: 1,
      },
    ]);
  });

  it("wraps timeout failures", async () => {
    const reader = createWebPageLinkReader({
      fetchImplementation: vi.fn(async (_input, init) => {
        init?.signal?.throwIfAborted();

        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        init?.signal?.throwIfAborted();

        return new Response("never reached", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/article",
        timeoutMs: 1,
        sameOriginOnly: false,
      }),
    ).rejects.toThrowError("Web request timed out after 1ms.");
  });

  it("throws WebPageLinksError instances", async () => {
    const reader = createWebPageLinkReader({
      fetchImplementation: vi.fn(async () => {
        return new Response("not found", {
          status: 404,
          statusText: "Not Found",
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/article",
        timeoutMs: 1_000,
        sameOriginOnly: false,
      }),
    ).rejects.toBeInstanceOf(WebPageLinksError);
  });
});
