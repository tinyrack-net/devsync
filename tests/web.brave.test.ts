import { describe, expect, it, vi } from "vitest";

import { createBraveSearchEngine, WebSearchError } from "#app/web/search.ts";

describe("createBraveSearchEngine", () => {
  it("requires an api key", async () => {
    const engine = createBraveSearchEngine({
      apiKey: undefined,
      fetchImplementation: fetch,
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError(
      "BRAVE_SEARCH_API_KEY is required for the brave search engine.",
    );
  });

  it("calls the brave api and parses results", async () => {
    const fetchImplementation: typeof fetch = vi.fn(async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));

      expect(url.origin).toBe("https://api.search.brave.com");
      expect(url.pathname).toBe("/res/v1/web/search");
      expect(url.searchParams.get("q")).toBe("typescript");
      expect(url.searchParams.get("count")).toBe("2");
      expect(url.searchParams.get("text_decorations")).toBe("false");
      expect(init?.headers).toEqual({
        Accept: "application/json",
        "X-Subscription-Token": "secret",
      });

      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "TypeScript",
                url: "https://example.com/typescript",
                description: "Typed JavaScript at any scale.",
              },
              {
                title: "Missing URL",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    });

    const engine = createBraveSearchEngine({
      apiKey: "secret",
      fetchImplementation,
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 2,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual([
      {
        title: "TypeScript",
        url: "https://example.com/typescript",
        description: "Typed JavaScript at any scale.",
      },
    ]);
  });

  it("wraps fetch failures", async () => {
    const engine = createBraveSearchEngine({
      apiKey: "secret",
      fetchImplementation: vi.fn(async () => {
        throw new Error("network down");
      }),
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Brave search request failed: network down");
  });

  it("wraps timeout failures", async () => {
    const engine = createBraveSearchEngine({
      apiKey: "secret",
      fetchImplementation: vi.fn(async (_input, init) => {
        init?.signal?.throwIfAborted();

        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        init?.signal?.throwIfAborted();

        return new Response("never reached", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }),
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1,
      }),
    ).rejects.toThrowError("Brave search request timed out after 1ms.");
  });

  it("returns a helpful error for non-ok responses", async () => {
    const engine = createBraveSearchEngine({
      apiKey: "secret",
      fetchImplementation: vi.fn(async () => {
        return new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        });
      }),
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError(
      "Brave search request failed with 429 Too Many Requests: rate limited",
    );
  });

  it("returns an empty result list for unexpected payloads", async () => {
    const engine = createBraveSearchEngine({
      apiKey: "secret",
      fetchImplementation: vi.fn(async () => {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }),
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual([]);
  });

  it("rejects unexpected content types", async () => {
    const engine = createBraveSearchEngine({
      apiKey: "secret",
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
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Unsupported content type: text/html.");
  });

  it("throws WebSearchError instances", async () => {
    const engine = createBraveSearchEngine({
      apiKey: "secret",
      fetchImplementation: vi.fn(async () => {
        return new Response("boom", {
          status: 500,
          statusText: "Internal Server Error",
        });
      }),
    });

    await expect(
      engine.search({
        query: "typescript",
        limit: 5,
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(WebSearchError);
  });
});
