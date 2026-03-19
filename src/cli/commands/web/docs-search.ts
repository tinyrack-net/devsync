import { Args, Command, Flags } from "@oclif/core";

import {
  createBraveSearchEngine,
  createSearchEngineRegistry,
  runWebDocsSearchCommand,
} from "#app/web/search.ts";
import { defaultWebRequestTimeoutMs } from "#app/web/shared.ts";

const createCommandSearchEngineRegistry = (apiKeyOverride?: string) => {
  const { BRAVE_SEARCH_API_KEY: braveSearchApiKey } = process.env;

  return createSearchEngineRegistry("brave", [
    createBraveSearchEngine({
      apiKey: apiKeyOverride ?? braveSearchApiKey,
      fetchImplementation: fetch,
    }),
  ]);
};

export default class WebDocsSearch extends Command {
  public static override summary =
    "Search documentation within a specific site or docs path";

  public static override args = {
    site: Args.string({
      description: "Hostname or docs base path, e.g. nodejs.org/docs",
      required: true,
    }),
    query: Args.string({
      description: "Keywords to search for",
      required: true,
    }),
  };

  public static override flags = {
    engine: Flags.string({
      char: "e",
      description: "Search engine to use",
    }),
    limit: Flags.integer({
      char: "l",
      default: 5,
      description: "Maximum number of results to return",
    }),
    json: Flags.boolean({
      default: false,
      description: "Print results as JSON",
    }),
    timeout: Flags.integer({
      char: "t",
      default: Number.parseInt(defaultWebRequestTimeoutMs, 10),
      description: "Request timeout in milliseconds",
    }),
    "api-key": Flags.string({
      description: "Override the API key for the selected engine",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(WebDocsSearch);
    const output = await runWebDocsSearchCommand(
      {
        site: args.site,
        query: args.query,
        options: {
          ...flags,
          apiKey: flags["api-key"],
        },
      },
      {
        createSearchEngineRegistry: createCommandSearchEngineRegistry,
      },
    );

    process.stdout.write(output);
  }
}
