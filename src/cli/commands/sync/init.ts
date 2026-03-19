import { Args, Command, Flags } from "@oclif/core";

import {
  createSyncManager,
  runSyncInitCommand,
} from "#app/services/sync/index.ts";

const syncManager = createSyncManager();

export default class SyncInit extends Command {
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
    const output = await runSyncInitCommand(
      {
        options: {
          identity: flags.identity,
          recipient: flags.recipient,
        },
        repository: args.repository,
      },
      {
        syncManager,
      },
    );

    process.stdout.write(output);
  }
}
