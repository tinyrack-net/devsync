import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { runWebSearchCommand } from "#app/web/search.ts";
import { defaultWebRequestTimeoutMs } from "#app/web/shared.ts";

export default class WebSearch extends BaseCommand {
  public static override summary = "Search the web";

  public static override args = {
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
    site: Flags.string({
      char: "s",
      description:
        "Restrict results to a hostname or docs path, e.g. nodejs.org/docs",
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
    const { args, flags } = await this.parse(WebSearch);
    const output = await runWebSearchCommand(
      {
        query: args.query,
        options: {
          ...flags,
          apiKey: flags["api-key"],
          engine:
            flags.engine ??
            this.services.createSearchEngineRegistry().defaultEngineName,
        },
      },
      {
        createSearchEngineRegistry: this.services.createSearchEngineRegistry,
      },
    );

    this.writeStdout(output);
  }
}
