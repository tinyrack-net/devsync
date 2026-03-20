import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.ts";
import { formatSyncInitResult } from "#app/lib/output.ts";
import { initializeSync } from "#app/services/init.ts";
import { createSyncContext } from "#app/services/runtime.ts";

export default class SyncInit extends BaseCommand {
  public static override summary = "Initialize the git-backed sync directory";

  public static override description =
    "Create or connect the local devsync repository under your XDG config directory, then store the sync settings used by later pull and push operations. If you omit the repository argument, devsync initializes a local git repository in the sync directory.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> https://example.com/my-sync-repo.git",
    '<%= config.bin %> <%= command.id %> --identity "$XDG_CONFIG_HOME/devsync/age/keys.txt" --recipient age1...',
  ];

  public static override args = {
    repository: Args.string({
      description: "Remote URL or local git repository path to clone",
      required: false,
    }),
  };

  public static override flags = {
    identity: Flags.string({
      helpValue: "path",
      summary: "Persist an age identity file path",
      description:
        "Store the age identity file path in config.json so later pull operations know which private key file to use for decrypting secret artifacts.",
    }),
    recipient: Flags.string({
      helpValue: "recipient",
      summary: "Persist an age recipient public key",
      description:
        "Add an age recipient public key to config.json. Repeat this flag to encrypt secrets for multiple recipients during push operations.",
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
