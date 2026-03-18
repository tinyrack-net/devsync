import { describe, expect, it } from "vitest";

import {
  createSearchEngineRegistry,
  runWebSearch,
  WebSearchError,
} from "#app/web/search.ts";

type WebSearchEngine = Parameters<typeof createSearchEngineRegistry>[1][number];

const createEngine = (
  name: string,
  results: readonly {
    title: string;
    url: string;
    description: string | undefined;
  }[],
) => {
  return {
    name,
    search: async () => results,
  } satisfies WebSearchEngine;
};

describe("createSearchEngineRegistry", () => {
  it("sorts engine names and exposes the default engine", () => {
    const registry = createSearchEngineRegistry("brave", [
      createEngine("duck", []),
      createEngine("brave", []),
    ]);

    expect(registry.defaultEngineName).toBe("brave");
    expect(registry.names()).toEqual(["brave", "duck"]);
    expect(registry.get("duck")?.name).toBe("duck");
  });

  it("throws when the default engine is not registered", () => {
    expect(() => {
      createSearchEngineRegistry("brave", [createEngine("duck", [])]);
    }).toThrowError("Unknown default search engine: brave");
  });
});

describe("runWebSearch", () => {
  it("formats text output", async () => {
    const registry = createSearchEngineRegistry("brave", [
      createEngine("brave", [
        {
          title: "TypeScript",
          url: "https://example.com/typescript",
          description: "Typed JavaScript at any scale.",
        },
        {
          title: "Node.js",
          url: "https://example.com/node",
          description: undefined,
        },
      ]),
    ]);

    const output = await runWebSearch(
      {
        engineName: "brave",
        query: "typescript",
        limit: 5,
        json: false,
      },
      registry,
    );

    expect(output).toBe(
      [
        "1. TypeScript",
        "   https://example.com/typescript",
        "   Typed JavaScript at any scale.",
        "",
        "2. Node.js",
        "   https://example.com/node",
        "",
      ].join("\n"),
    );
  });

  it("formats json output", async () => {
    const registry = createSearchEngineRegistry("brave", [
      createEngine("brave", [
        {
          title: "TypeScript",
          url: "https://example.com/typescript",
          description: "Typed JavaScript at any scale.",
        },
      ]),
    ]);

    const output = await runWebSearch(
      {
        engineName: "brave",
        query: "typescript",
        limit: 5,
        json: true,
      },
      registry,
    );

    expect(JSON.parse(output)).toEqual({
      engine: "brave",
      query: "typescript",
      results: [
        {
          title: "TypeScript",
          url: "https://example.com/typescript",
          description: "Typed JavaScript at any scale.",
        },
      ],
    });
  });

  it("returns a no-results message", async () => {
    const registry = createSearchEngineRegistry("brave", [
      createEngine("brave", []),
    ]);

    const output = await runWebSearch(
      {
        engineName: "brave",
        query: "typescript",
        limit: 5,
        json: false,
      },
      registry,
    );

    expect(output).toBe('No results found for "typescript" using brave.\n');
  });

  it("throws for an unknown engine", async () => {
    const registry = createSearchEngineRegistry("brave", [
      createEngine("brave", []),
      createEngine("duck", []),
    ]);

    await expect(
      runWebSearch(
        {
          engineName: "missing",
          query: "typescript",
          limit: 5,
          json: false,
        },
        registry,
      ),
    ).rejects.toBeInstanceOf(WebSearchError);

    await expect(
      runWebSearch(
        {
          engineName: "missing",
          query: "typescript",
          limit: 5,
          json: false,
        },
        registry,
      ),
    ).rejects.toThrowError(
      "Unknown search engine: missing. Available engines: brave, duck",
    );
  });
});
