import { describe, expect, it, vi } from "vitest";

import { createFetchWebClient } from "../src/web/fetch-client.ts";
import { WebPageReadError } from "../src/web/read.ts";

describe("createFetchWebClient", () => {
  it("sends accept and user-agent headers", async () => {
    const fetchImplementation: typeof fetch = vi.fn(async (_input, init) => {
      const headers = init?.headers as Headers;

      expect(headers.get("accept")).toBe("text/html");
      expect(headers.get("user-agent")).toBe("devtools-test");

      return new Response("ok", {
        headers: {
          "Content-Type": "text/plain",
        },
        status: 200,
      });
    });
    const client = createFetchWebClient({
      fetchImplementation,
      userAgent: "devtools-test",
    });

    const result = await client.fetchText({
      url: "https://example.com/resource",
      timeoutMs: 1_000,
      accept: "text/html",
    });

    expect(result).toMatchObject({
      body: "ok",
      contentType: "text/plain",
      requestedUrl: "https://example.com/resource",
      finalUrl: "https://example.com/resource",
      status: 200,
      statusText: "",
    });
  });

  it("uses the final response url when available", async () => {
    const response = new Response("redirected", {
      headers: {
        "Content-Type": "text/plain",
      },
      status: 200,
    });

    Object.defineProperty(response, "url", {
      value: "https://example.com/final",
    });

    const client = createFetchWebClient({
      fetchImplementation: vi.fn(async () => response),
    });

    const result = await client.fetchText({
      url: "https://example.com/original",
      timeoutMs: 1_000,
    });

    expect(result.finalUrl).toBe("https://example.com/final");
  });

  it("throws helpful errors for non-ok responses", async () => {
    const client = createFetchWebClient({
      fetchImplementation: vi.fn(async () => {
        return new Response("nope", {
          status: 503,
          statusText: "Service Unavailable",
        });
      }),
    });

    await expect(
      client.fetchText({
        url: "https://example.com/down",
        timeoutMs: 1_000,
      }),
    ).rejects.toThrowError("Web request failed with 503 Service Unavailable.");
  });

  it("throws WebPageReadError instances on timeout", async () => {
    const client = createFetchWebClient({
      fetchImplementation: vi.fn(async (_input, init) => {
        init?.signal?.throwIfAborted();
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        init?.signal?.throwIfAborted();

        return new Response("late", {
          status: 200,
        });
      }),
    });

    await expect(
      client.fetchText({
        url: "https://example.com/slow",
        timeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(WebPageReadError);
  });
});
