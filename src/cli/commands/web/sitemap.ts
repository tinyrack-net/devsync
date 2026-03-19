import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { defaultWebRequestTimeoutMs } from "#app/web/shared.ts";
import {
  defaultSitemapConcurrency,
  runWebSitemapCommand,
} from "#app/web/sitemap.ts";

export default class WebSitemap extends BaseCommand {
  public static override summary =
    "Read a sitemap.xml file or discover sitemap URLs for a site";

  public static override args = {
    url: Args.string({
      description: "Site URL or sitemap XML URL",
      required: true,
    }),
  };

  public static override flags = {
    json: Flags.boolean({
      default: false,
      description: "Print sitemap results as JSON",
    }),
    "same-origin": Flags.boolean({
      default: false,
      description: "Only include same-origin sitemap URLs",
    }),
    concurrency: Flags.integer({
      char: "c",
      default: Number.parseInt(defaultSitemapConcurrency, 10),
      description: "Maximum number of sitemap requests to run at once",
    }),
    timeout: Flags.integer({
      char: "t",
      default: Number.parseInt(defaultWebRequestTimeoutMs, 10),
      description: "Request timeout in milliseconds",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(WebSitemap);
    const output = await runWebSitemapCommand(
      {
        url: args.url,
        options: {
          concurrency: flags.concurrency,
          json: flags.json,
          sameOrigin: flags["same-origin"],
          timeout: flags.timeout,
        },
      },
      {
        webSitemapReader: this.services.webSitemapReader,
      },
    );

    this.writeStdout(output);
  }
}
