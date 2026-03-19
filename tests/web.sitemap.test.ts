import { describe, expect, it, vi } from "vitest";

import {
  createWebSitemapReader,
  formatWebSitemap,
  runWebSitemapCommand,
  WebSitemapError,
} from "#app/services/web/sitemap.ts";

type WebSitemap = Awaited<
  ReturnType<ReturnType<typeof createWebSitemapReader>["read"]>
>;

const sampleSitemap = {
  requestedUrl: "https://example.com/",
  sitemapUrls: ["https://example.com/sitemap.xml"],
  sameOriginOnly: false,
  urls: [
    {
      url: "https://example.com/",
      lastModified: undefined,
    },
  ],
} satisfies WebSitemap;

const createFetchImplementation = (
  responses: Record<string, Response | (() => Response | Promise<Response>)>,
): typeof fetch => {
  return vi.fn(async (input) => {
    const url = input instanceof URL ? input.toString() : String(input);
    const response = responses[url];

    if (response === undefined) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    if (typeof response === "function") {
      return await response();
    }

    return response;
  });
};

describe("formatWebSitemap", () => {
  it("formats text output", () => {
    expect(formatWebSitemap(sampleSitemap, false)).toContain(
      "1. https://example.com/",
    );
  });

  it("formats json output", () => {
    expect(JSON.parse(formatWebSitemap(sampleSitemap, true))).toEqual(
      sampleSitemap,
    );
  });
});

describe("runWebSitemapCommand", () => {
  it("maps validated input to the sitemap reader and formats json output", async () => {
    const requests: Array<{
      url: string;
      timeoutMs: number;
      sameOriginOnly: boolean;
      concurrency: number;
    }> = [];

    const output = await runWebSitemapCommand(
      {
        url: "https://example.com",
        options: {
          concurrency: 2,
          json: true,
          sameOrigin: true,
          timeout: 1_000,
        },
      },
      {
        webSitemapReader: {
          read: async (request) => {
            requests.push(request);

            return {
              ...sampleSitemap,
              requestedUrl: request.url,
              sameOriginOnly: request.sameOriginOnly,
            };
          },
        },
      },
    );

    expect(JSON.parse(output)).toMatchObject({
      requestedUrl: "https://example.com",
      sameOriginOnly: true,
    });
    expect(requests).toEqual([
      {
        url: "https://example.com",
        timeoutMs: 1_000,
        sameOriginOnly: true,
        concurrency: 2,
      },
    ]);
  });

  it("validates concurrency values", async () => {
    await expect(
      runWebSitemapCommand(
        {
          url: "https://example.com",
          options: {
            concurrency: 0,
            json: false,
            sameOrigin: false,
            timeout: 1_000,
          },
        },
        {
          webSitemapReader: {
            read: async () => sampleSitemap,
          },
        },
      ),
    ).rejects.toThrowError("Concurrency must be greater than 0.");
  });
});

describe("createWebSitemapReader", () => {
  it("discovers sitemap urls from robots.txt, handles cycles, and deduplicates urls", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: createFetchImplementation({
        "https://example.com/robots.txt": new Response(
          [
            "Sitemap: https://example.com/root-index.xml",
            "Sitemap: https://example.com/root-index.xml",
          ].join("\n"),
          {
            status: 200,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          },
        ),
        "https://example.com/root-index.xml": new Response(
          `
            <?xml version="1.0" encoding="UTF-8"?>
            <sitemapindex>
              <sitemap><loc>https://example.com/a.xml</loc></sitemap>
              <sitemap><loc>https://example.com/b.xml</loc></sitemap>
              <sitemap><loc>https://external.example.com/offsite.xml</loc></sitemap>
            </sitemapindex>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
            },
          },
        ),
        "https://example.com/a.xml": new Response(
          `
            <?xml version="1.0" encoding="UTF-8"?>
            <sitemapindex>
              <sitemap><loc>https://example.com/b.xml</loc></sitemap>
              <sitemap><loc>https://example.com/c.xml</loc></sitemap>
            </sitemapindex>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
            },
          },
        ),
        "https://example.com/b.xml": new Response(
          `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
              <url><loc>https://example.com/shared</loc></url>
              <url><loc>https://example.com/one</loc></url>
            </urlset>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "text/xml; charset=utf-8",
            },
          },
        ),
        "https://example.com/c.xml": new Response(
          `
            <?xml version="1.0" encoding="UTF-8"?>
            <urlset>
              <url><loc>https://example.com/shared</loc><lastmod>2025-03-18</lastmod></url>
              <url><loc>https://example.com/two</loc></url>
              <url><loc>https://external.example.com/offsite</loc></url>
            </urlset>
          `,
          {
            status: 200,
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
            },
          },
        ),
      }),
      userAgent: "devtools-test",
    });

    const sitemap = await reader.read({
      url: "https://example.com",
      timeoutMs: 1_000,
      sameOriginOnly: true,
      concurrency: 2,
    });

    expect(sitemap).toEqual({
      requestedUrl: "https://example.com/",
      sitemapUrls: [
        "https://example.com/a.xml",
        "https://example.com/b.xml",
        "https://example.com/c.xml",
        "https://example.com/root-index.xml",
      ],
      sameOriginOnly: true,
      urls: [
        {
          url: "https://example.com/one",
          lastModified: undefined,
        },
        {
          url: "https://example.com/shared",
          lastModified: "2025-03-18",
        },
        {
          url: "https://example.com/two",
          lastModified: undefined,
        },
      ],
    });
  });

  it("reads a sitemap directly when the request url already points to xml", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: createFetchImplementation({
        "https://example.com/sitemap.xml": new Response(
          "<?xml version='1.0'?><urlset><url><loc>https://example.com/</loc></url></urlset>",
          {
            status: 200,
            headers: {
              "Content-Type": "application/xml",
            },
          },
        ),
      }),
    });

    const sitemap = await reader.read({
      url: "https://example.com/sitemap.xml#fragment",
      timeoutMs: 1_000,
      sameOriginOnly: false,
      concurrency: 1,
    });

    expect(sitemap).toEqual({
      requestedUrl: "https://example.com/sitemap.xml",
      sitemapUrls: ["https://example.com/sitemap.xml"],
      sameOriginOnly: false,
      urls: [
        {
          url: "https://example.com/",
          lastModified: undefined,
        },
      ],
    });
  });

  it("falls back to /sitemap.xml when robots.txt is unavailable", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: createFetchImplementation({
        "https://example.com/robots.txt": new Response("missing", {
          status: 404,
          statusText: "Not Found",
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
        "https://example.com/sitemap.xml": new Response(
          "<?xml version='1.0'?><urlset><url><loc>https://example.com/</loc></url></urlset>",
          {
            status: 200,
            headers: {
              "Content-Type": "application/xml",
            },
          },
        ),
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com",
        timeoutMs: 1_000,
        sameOriginOnly: false,
        concurrency: 1,
      }),
    ).resolves.toMatchObject({
      sitemapUrls: ["https://example.com/sitemap.xml"],
    });
  });

  it("rejects xml documents that are not sitemaps", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: createFetchImplementation({
        "https://example.com/sitemap.xml": new Response("<feed></feed>", {
          status: 200,
          headers: {
            "Content-Type": "application/xml",
          },
        }),
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/sitemap.xml",
        timeoutMs: 1_000,
        sameOriginOnly: false,
        concurrency: 1,
      }),
    ).rejects.toThrowError("XML document is not a sitemap or sitemap index.");
  });

  it("fails when a nested sitemap request fails", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: createFetchImplementation({
        "https://example.com/root.xml": new Response(
          "<?xml version='1.0'?><sitemapindex><sitemap><loc>https://example.com/missing.xml</loc></sitemap></sitemapindex>",
          {
            status: 200,
            headers: {
              "Content-Type": "application/xml",
            },
          },
        ),
        "https://example.com/missing.xml": new Response("missing", {
          status: 404,
          statusText: "Not Found",
          headers: {
            "Content-Type": "application/xml",
          },
        }),
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/root.xml",
        timeoutMs: 1_000,
        sameOriginOnly: false,
        concurrency: 2,
      }),
    ).rejects.toThrowError("Sitemap request failed with 404 Not Found.");
  });

  it("wraps timeout failures", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: vi.fn(async (_input, init) => {
        init?.signal?.throwIfAborted();

        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        init?.signal?.throwIfAborted();

        return new Response("never reached", {
          status: 200,
          headers: {
            "Content-Type": "application/xml",
          },
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/sitemap.xml",
        timeoutMs: 1,
        sameOriginOnly: false,
        concurrency: 1,
      }),
    ).rejects.toThrowError("Sitemap request timed out after 1ms.");
  });

  it("throws WebSitemapError instances", async () => {
    const reader = createWebSitemapReader({
      fetchImplementation: vi.fn(async () => {
        return new Response("<html></html>", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
          },
        });
      }),
    });

    await expect(
      reader.read({
        url: "https://example.com/sitemap.xml",
        timeoutMs: 1_000,
        sameOriginOnly: false,
        concurrency: 1,
      }),
    ).rejects.toBeInstanceOf(WebSitemapError);
  });
});
