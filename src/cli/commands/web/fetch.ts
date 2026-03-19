import { Args, Command, Flags } from "@oclif/core";

import {
  createFetchWebPageReader,
  runWebFetchCommand,
  webPageOutputFormats,
} from "#app/services/web/fetch.ts";
import { defaultWebRequestTimeoutMs } from "#app/services/web/http.ts";

const webPageReader = createFetchWebPageReader({
  fetchImplementation: fetch,
  userAgent: "devtools/0.1.0",
});

export default class WebFetch extends Command {
  public static override summary =
    "Fetch a web page and convert it to structured output";

  public static override args = {
    url: Args.string({
      description: "Web page URL",
      required: true,
    }),
  };

  public static override flags = {
    format: Flags.string({
      char: "f",
      default: "markdown",
      description: "Output format",
      options: [...webPageOutputFormats],
    }),
    timeout: Flags.integer({
      char: "t",
      default: Number.parseInt(defaultWebRequestTimeoutMs, 10),
      description: "Request timeout in milliseconds",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(WebFetch);
    const output = await runWebFetchCommand(
      {
        url: args.url,
        options: flags,
      },
      {
        webPageReader,
      },
    );

    process.stdout.write(output);
  }
}
