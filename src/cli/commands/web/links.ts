import { Args, Command, Flags } from "@oclif/core";

import { createWebPageLinkReader, runWebLinksCommand } from "#app/web/links.ts";
import { defaultWebRequestTimeoutMs } from "#app/web/shared.ts";

const webPageLinkReader = createWebPageLinkReader({
  fetchImplementation: fetch,
  userAgent: "devtools/0.1.0",
});

export default class WebLinks extends Command {
  public static override summary =
    "Fetch a web page and extract normalized links";

  public static override args = {
    url: Args.string({
      description: "Web page URL",
      required: true,
    }),
  };

  public static override flags = {
    json: Flags.boolean({
      default: false,
      description: "Print links as JSON",
    }),
    "same-origin": Flags.boolean({
      default: false,
      description: "Only include same-origin links",
    }),
    timeout: Flags.integer({
      char: "t",
      default: Number.parseInt(defaultWebRequestTimeoutMs, 10),
      description: "Request timeout in milliseconds",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(WebLinks);
    const output = await runWebLinksCommand(
      {
        url: args.url,
        options: {
          json: flags.json,
          sameOrigin: flags["same-origin"],
          timeout: flags.timeout,
        },
      },
      {
        webPageLinkReader,
      },
    );

    process.stdout.write(output);
  }
}
