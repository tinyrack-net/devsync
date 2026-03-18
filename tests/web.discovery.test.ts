import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  createWebDiscoveryService,
  formatWebCrawl,
  formatWebRobots,
  formatWebSitemap,
} from "../src/web/discovery.ts";
import { WebPageReadError } from "../src/web/read.ts";

const createDiscoveryService = () => {
  return createWebDiscoveryService(
    {
      fetchText: async (request) => {
        if (request.url.endsWith("/robots.txt")) {
          return {
            requestedUrl: request.url,
            finalUrl: request.url,
            contentType: "text/plain",
            body: [
              "User-agent: *",
              "Allow: /",
              "Disallow: /private",
              "Sitemap: https://example.com/sitemap.xml",
              "",
              "User-agent: devtools",
              "Allow: /special",
              "Crawl-delay: 5",
            ].join("\n"),
            status: 200,
            statusText: "OK",
          };
        }

        if (request.url.endsWith("/sitemap-index.xml")) {
          return {
            requestedUrl: request.url,
            finalUrl: request.url,
            contentType: "application/xml",
            body: "<sitemapindex><sitemap><loc>https://example.com/sitemap.xml</loc></sitemap><sitemap><loc>https://example.com/extra.xml</loc></sitemap></sitemapindex>",
            status: 200,
            statusText: "OK",
          };
        }

        if (request.url.endsWith("/bad-sitemap.xml")) {
          return {
            requestedUrl: request.url,
            finalUrl: request.url,
            contentType: "application/json",
            body: "{}",
            status: 200,
            statusText: "OK",
          };
        }

        return {
          requestedUrl: request.url,
          finalUrl: request.url,
          contentType: "application/xml",
          body: "<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/docs</loc></url><url><loc>https://example.com/guide?a=1&amp;b=2</loc></url></urlset>",
          status: 200,
          statusText: "OK",
        };
      },
    },
    {
      load: async (request) => {
        const htmlByUrl: Record<string, string> = {
          "https://example.com/":
            '<html><head><title>Home</title><meta name="description" content="Home page" /></head><body><a href="/docs">Docs</a><a href="/loop">Loop</a><a href="https://outside.example/offsite">Offsite</a></body></html>',
          "https://example.com/docs":
            '<html><head><title>Docs</title></head><body><a href="/guide">Guide</a><a href="/">Home</a></body></html>',
          "https://example.com/guide":
            '<html><head><title>Guide</title></head><body><a href="/docs">Docs</a></body></html>',
          "https://example.com/loop":
            '<html><head><title>Loop</title></head><body><a href="/">Home</a></body></html>',
          "https://outside.example/offsite":
            "<html><head><title>Offsite</title></head><body></body></html>",
        };
        const html =
          htmlByUrl[request.url] ??
          "<html><head><title>Unknown</title></head><body></body></html>";

        return {
          requestedUrl: request.url,
          finalUrl: request.url,
          html,
          dom: new JSDOM(html, { url: request.url }),
        };
      },
    },
  );
};

describe("createWebDiscoveryService", () => {
  it("parses robots files with multiple groups", async () => {
    const result = await createDiscoveryService().robots({
      url: "https://example.com/article",
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({
      robotsUrl: "https://example.com/robots.txt",
      sitemaps: ["https://example.com/sitemap.xml"],
      groups: [
        {
          userAgents: ["*"],
          allow: ["/"],
          disallow: ["/private"],
        },
        {
          userAgents: ["devtools"],
          allow: ["/special"],
          crawlDelay: 5,
        },
      ],
    });
    expect(formatWebRobots(result, "text")).toContain("User-agent: devtools");
  });

  it("parses normal sitemaps and decodes XML entities", async () => {
    const result = await createDiscoveryService().sitemap({
      url: "https://example.com/",
      timeoutMs: 1_000,
    });

    expect(result.urls).toEqual([
      "https://example.com/",
      "https://example.com/docs",
      "https://example.com/guide?a=1&b=2",
    ]);
    expect(formatWebSitemap(result, "text")).toContain(
      "https://example.com/guide?a=1&b=2",
    );
  });

  it("parses sitemap indexes", async () => {
    const result = await createDiscoveryService().sitemap({
      url: "https://example.com/sitemap-index.xml",
      timeoutMs: 1_000,
    });

    expect(result.sitemaps).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/extra.xml",
    ]);
  });

  it("rejects unsupported sitemap content types", async () => {
    await expect(
      createDiscoveryService().sitemap({
        url: "https://example.com/bad-sitemap.xml",
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(WebPageReadError);

    await expect(
      createDiscoveryService().sitemap({
        url: "https://example.com/bad-sitemap.xml",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError(
      "Unsupported sitemap content type: application/json.",
    );
  });

  it("crawls bounded pages and deduplicates loops", async () => {
    const result = await createDiscoveryService().crawl({
      url: "https://example.com/",
      timeoutMs: 1_000,
      maxPages: 10,
      maxDepth: 1,
      sameOrigin: true,
      include: undefined,
      exclude: undefined,
    });

    expect(result.pages).toEqual([
      {
        requestedUrl: "https://example.com/",
        finalUrl: "https://example.com/",
        title: "Home",
        description: "Home page",
        depth: 0,
      },
      {
        requestedUrl: "https://example.com/docs",
        finalUrl: "https://example.com/docs",
        title: "Docs",
        description: undefined,
        depth: 1,
      },
      {
        requestedUrl: "https://example.com/loop",
        finalUrl: "https://example.com/loop",
        title: "Loop",
        description: undefined,
        depth: 1,
      },
    ]);
    expect(formatWebCrawl(result, "text")).toContain(
      "https://example.com/docs",
    );
  });

  it("supports include and exclude filters during crawling", async () => {
    const included = await createDiscoveryService().crawl({
      url: "https://example.com/",
      timeoutMs: 1_000,
      maxPages: 10,
      maxDepth: 2,
      sameOrigin: true,
      include: "/docs",
      exclude: undefined,
    });
    const excluded = await createDiscoveryService().crawl({
      url: "https://example.com/",
      timeoutMs: 1_000,
      maxPages: 10,
      maxDepth: 2,
      sameOrigin: true,
      include: undefined,
      exclude: "/docs",
    });

    expect(included.pages.map((page) => page.finalUrl)).toEqual([
      "https://example.com/",
      "https://example.com/docs",
    ]);
    expect(excluded.pages.map((page) => page.finalUrl)).toEqual([
      "https://example.com/",
      "https://example.com/loop",
    ]);
  });

  it("can cross origins when sameOrigin is disabled", async () => {
    const result = await createDiscoveryService().crawl({
      url: "https://example.com/",
      timeoutMs: 1_000,
      maxPages: 10,
      maxDepth: 1,
      sameOrigin: false,
      include: undefined,
      exclude: undefined,
    });

    expect(
      result.pages.some(
        (page) => page.finalUrl === "https://outside.example/offsite",
      ),
    ).toBe(true);
  });
});
