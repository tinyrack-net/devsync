import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncInitResult } from "#app/lib/output.ts";
import { initializeSync } from "#app/services/init.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncInit extends BaseCommand {
  public static override summary = "Initialize the git-backed sync directory";

  public static override args = {
    repository: Args.string({
      description: "Remote URL or local git repository path to clone",
      required: false,
    }),
  };

  public static override flags = {
    identity: Flags.string({
      description:
        "Age identity file path to persist in config.json for later pulls",
    }),
    recipient: Flags.string({
      description: "Age recipient public key to persist in config.json",
      multiple: true,
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncInit);
    const output = formatSyncInitResult(
      await initializeSync(
        {
          identityFile: flags.identity,
          recipients: flags.recipient ?? [],
          repository: args.repository,
        },
        createSyncContext(),
      ),
    );

    this.print(output);
  }
}
