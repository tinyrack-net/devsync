import { buildCommand } from "@stricli/core";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.js";
import { formatSyncInitResult } from "#app/lib/output.js";
import { pathExists } from "#app/services/filesystem.js";
import { defaultSyncIdentityFile, initializeSync } from "#app/services/init.js";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.js";
import { promptForSecret } from "#app/services/terminal/prompt.js";

type InitFlags = {
  identity?: string;
  key?: string;
  recipient?: readonly string[];
  verbose?: boolean;
};

const initCommand = buildCommand<InitFlags, [string?], DevsyncCliContext>({
  docs: {
    brief: "Initialize the git-backed sync directory",
    fullDescription:
      "Create or connect the local devsync repository under your XDG config directory, then store the sync settings used by later pull and push operations. If you omit the repository argument, devsync initializes a local git repository in the sync directory.",
  },
  async func(flags, repository) {
    const verbose = isVerbose(flags.verbose);
    const progress = createProgressReporter(verbose);
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
          repository,
        },
        process.env,
        progress,
      ),
      { verbose },
    );

    print(output);
  },
  parameters: {
    flags: {
      identity: {
        brief: "Persist an age identity file path",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "path",
      },
      key: {
        brief: "Persist an age private key into the identity file",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "age-private-key",
      },
      recipient: {
        brief: "Persist an age recipient public key",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "recipient",
        variadic: true,
      },
      verbose: verboseFlag,
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Remote URL or local git repository path to clone",
          optional: true,
          parse: String,
          placeholder: "repository",
        },
      ],
    },
  },
});

export default initCommand;
