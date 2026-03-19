import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { runWebInspectCommand } from "#app/web/inspect.ts";
import { defaultWebRequestTimeoutMs } from "#app/web/shared.ts";

export default class WebInspect extends BaseCommand {
  public static override summary =
    "Fetch a web page and print metadata without article extraction";

  public static override args = {
    url: Args.string({
      description: "Web page URL",
      required: true,
    }),
  };

  public static override flags = {
    json: Flags.boolean({
      default: false,
      description: "Print inspection results as JSON",
    }),
    timeout: Flags.integer({
      char: "t",
      default: Number.parseInt(defaultWebRequestTimeoutMs, 10),
      description: "Request timeout in milliseconds",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(WebInspect);
    const output = await runWebInspectCommand(
      {
        url: args.url,
        options: flags,
      },
      {
        webPageInspector: this.services.webPageInspector,
      },
    );

    this.writeStdout(output);
  }
}
