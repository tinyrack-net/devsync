import { describe, expect, it, vi } from "vitest";

import { isJsonObject } from "#app/lib/object.ts";
import {
  ensureTrailingNewline,
  normalizeWhitespace,
  readOptionalString,
  readString,
  splitTokens,
} from "#app/lib/string.ts";
import {
  formatInputIssues,
  trimmedOptionalStringSchema,
} from "#app/lib/validation.ts";
import {
  createRequestHeaders,
  fetchWithTimeout,
  requireContentType,
} from "#app/services/web/http.ts";
import {
  absoluteHttpUrlSchema,
  isSameOriginUrl,
  normalizeAbsoluteUrl,
  normalizeSearchSite,
} from "#app/services/web/url.ts";

describe("trimmedOptionalStringSchema", () => {
  it("normalizes blank values to undefined", () => {
    expect(trimmedOptionalStringSchema.parse("   ")).toBeUndefined();
    expect(trimmedOptionalStringSchema.parse(undefined)).toBeUndefined();
    expect(trimmedOptionalStringSchema.parse("  value  ")).toBe("value");
  });
});

describe("absoluteHttpUrlSchema", () => {
  it("accepts absolute http and https urls", () => {
    expect(absoluteHttpUrlSchema.parse("https://example.com")).toBe(
      "https://example.com",
    );
    expect(absoluteHttpUrlSchema.parse("http://example.com")).toBe(
      "http://example.com",
    );
  });

  it("rejects invalid or unsupported urls", () => {
    const invalidResult = absoluteHttpUrlSchema.safeParse("not-a-url");
    const unsupportedResult =
      absoluteHttpUrlSchema.safeParse("ftp://example.com");

    expect(invalidResult.success).toBe(false);
    expect(unsupportedResult.success).toBe(false);

    if (!invalidResult.success && !unsupportedResult.success) {
      expect(formatInputIssues(invalidResult.error.issues)).toContain(
        "URL must be a valid absolute URL.",
      );
      expect(formatInputIssues(unsupportedResult.error.issues)).toContain(
        "URL must use http or https.",
      );
    }
  });
});

describe("normalizeWhitespace", () => {
  it("normalizes line endings and collapses large blank regions", () => {
    expect(normalizeWhitespace("\r\nalpha\n\n\n\nbeta\n")).toBe(
      "alpha\n\nbeta",
    );
  });
});

describe("ensureTrailingNewline", () => {
  it("adds a trailing newline when needed", () => {
    expect(ensureTrailingNewline("alpha")).toBe("alpha\n");
    expect(ensureTrailingNewline("alpha\n")).toBe("alpha\n");
  });
});

describe("createRequestHeaders", () => {
  it("creates request headers with an optional user agent", () => {
    const headers = createRequestHeaders("application/json", "devtools-test");

    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toBe("devtools-test");
  });

  it("omits empty user agents", () => {
    const headers = createRequestHeaders("text/html", "");

    expect(headers.get("user-agent")).toBeNull();
  });
});

describe("fetchWithTimeout", () => {
  it("passes request init values through to fetch", async () => {
    const fetchImplementation: typeof fetch = vi.fn(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ Accept: "application/json" });

      return new Response("ok", {
        status: 200,
      });
    });

    const response = await fetchWithTimeout({
      url: "https://example.com/data",
      timeoutMs: 1_000,
      subject: "Example request",
      fetchImplementation,
      headers: {
        Accept: "application/json",
      },
      init: {
        method: "POST",
      },
    });

    expect(await response.text()).toBe("ok");
  });

  it("wraps fetch failures", async () => {
    await expect(
      fetchWithTimeout({
        url: "https://example.com/data",
        timeoutMs: 1_000,
        subject: "Example request",
        fetchImplementation: vi.fn(async () => {
          throw new Error("network down");
        }),
      }),
    ).rejects.toThrowError("Example request failed: network down");
  });

  it("throws a timeout error", async () => {
    await expect(
      fetchWithTimeout({
        url: "https://example.com/data",
        timeoutMs: 1,
        subject: "Example request",
        fetchImplementation: vi.fn(async (_input, init) => {
          init?.signal?.throwIfAborted();

          await new Promise((resolve) => {
            setTimeout(resolve, 20);
          });

          init?.signal?.throwIfAborted();

          return new Response("never reached", {
            status: 200,
          });
        }),
      }),
    ).rejects.toThrowError("Example request timed out after 1ms.");
  });
});

describe("requireContentType", () => {
  it("returns matching content types", () => {
    const response = new Response("ok", {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    });

    expect(requireContentType(response, ["application/json"])).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("throws for unsupported content types", () => {
    const response = new Response("ok", {
      headers: {
        "Content-Type": "text/plain",
      },
    });

    expect(() => {
      requireContentType(response, ["application/json"]);
    }).toThrowError("Unsupported content type: text/plain.");
  });
});

describe("miscellaneous value helpers", () => {
  it("reads optional strings and object string properties", () => {
    expect(readOptionalString("  alpha  ")).toBe("alpha");
    expect(readOptionalString("   ")).toBeUndefined();
    expect(readString({ alpha: "beta" }, "alpha")).toBe("beta");
    expect(readString({ alpha: 42 }, "alpha")).toBeUndefined();
  });

  it("detects json objects", () => {
    expect(isJsonObject({ alpha: true })).toBe(true);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(["alpha"])).toBe(true);
    expect(isJsonObject("alpha")).toBe(false);
  });
});

describe("normalizeAbsoluteUrl", () => {
  it("removes default ports and hashes by default", () => {
    expect(normalizeAbsoluteUrl("HTTPS://Example.COM:443/path?q=1#frag")).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("can preserve hashes", () => {
    expect(
      normalizeAbsoluteUrl("https://example.com/path?q=1#frag", {
        keepHash: true,
      }),
    ).toBe("https://example.com/path?q=1#frag");
  });
});

describe("isSameOriginUrl", () => {
  it("compares url origins", () => {
    expect(
      isSameOriginUrl("https://example.com/docs", "https://example.com/a"),
    ).toBe(true);
    expect(
      isSameOriginUrl(
        "https://docs.example.com/guide",
        "https://example.com/a",
      ),
    ).toBe(false);
  });
});

describe("normalizeSearchSite", () => {
  it("normalizes hostnames, paths, casing, and trailing slashes", () => {
    expect(normalizeSearchSite(" NodeJS.org/Docs/Latest/ ")).toBe(
      "nodejs.org/Docs/Latest",
    );
    expect(normalizeSearchSite("https://VITEST.dev/guide/")).toBe(
      "vitest.dev/guide",
    );
  });

  it("rejects empty or invalid values", () => {
    expect(() => {
      normalizeSearchSite("   ");
    }).toThrowError("Site must not be empty.");

    expect(() => {
      normalizeSearchSite("http://");
    }).toThrowError("Site must be a valid hostname or absolute URL.");
  });
});

describe("splitTokens", () => {
  it("deduplicates, normalizes, and sorts tokens", () => {
    expect(splitTokens(" noopener   nofollow NOOPENER ")).toEqual([
      "nofollow",
      "noopener",
    ]);
    expect(splitTokens(undefined)).toEqual([]);
  });
});
