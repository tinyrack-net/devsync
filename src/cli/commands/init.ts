import { Args, Flags } from "@oclif/core";

import { BaseCommand } from "#app/cli/base-command.js";
import { promptForSecret } from "#app/cli/prompt.js";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.js";
import { formatSyncInitResult } from "#app/lib/output.js";
import { pathExists } from "#app/services/filesystem.js";
import { defaultSyncIdentityFile, initializeSync } from "#app/services/init.js";

export default class SyncInit extends BaseCommand {
  public static override summary = "Initialize the git-backed sync directory";

  public static override description =
    "Create or connect the local devsync repository under your XDG config directory, then store the sync settings used by later pull and push operations. If you omit the repository argument, devsync initializes a local git repository in the sync directory.";

  public static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> https://example.com/my-sync-repo.git",
    '<%= config.bin %> <%= command.id %> --key "AGE-SECRET-KEY-..."',
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
        "Store the age identity file path in manifest.json so later pull operations know which private key file to use for decrypting secret artifacts.",
    }),
    recipient: Flags.string({
      helpValue: "recipient",
      summary: "Persist an age recipient public key",
      description:
        "Add an age recipient public key to manifest.json. Repeat this flag to encrypt secrets for multiple recipients during push operations.",
      multiple: true,
    }),
    key: Flags.string({
      helpValue: "age-private-key",
      summary: "Persist an age private key into the identity file",
      description:
        "Validate the provided age private key, write it to the configured identity file, and derive its recipient automatically.",
    }),
  };

  public override async run(): Promise<void> {
    const { args, flags } = await this.parse(SyncInit);
    const requestedKey = flags.key?.trim();
    const configuredIdentityFile =
      flags.identity?.trim() || defaultSyncIdentityFile;
    const identityFile = resolveConfiguredAbsolutePath(
      configuredIdentityFile,
      process.env,
    );
    const shouldPrompt =
      requestedKey === undefined && !(await pathExists(identityFile));
    const promptedKey = shouldPrompt
      ? await promptForSecret(
          "Enter an age private key (leave empty to generate a new one): ",
        )
      : undefined;
    const trimmedPromptedKey = promptedKey?.trim();
    const output = formatSyncInitResult(
      await initializeSync(
        {
          ageIdentity:
            requestedKey !== undefined
              ? requestedKey
              : trimmedPromptedKey !== undefined && trimmedPromptedKey !== ""
                ? trimmedPromptedKey
                : undefined,
          generateAgeIdentity: shouldPrompt && trimmedPromptedKey === "",
          identityFile: flags.identity,
          recipients: flags.recipient ?? [],
          repository: args.repository,
        },
        process.env,
      ),
      { verbose: flags.verbose },
    );

    this.print(output);
  }
}
