import { buildCommand } from "@stricli/core";
import consola from "consola";
import pc from "picocolors";
import { resolveConfiguredIdentityFile } from "#app/config/identity-file.ts";
import { ENV } from "#app/lib/env.ts";
import { pathExists } from "#app/lib/filesystem.ts";
import {
  defaultSyncIdentityFile,
  type InitResult,
  initializeSyncDirectory,
} from "#app/services/init.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type InitFlags = {
  identity?: string;
  key?: string;
  recipient?: readonly string[];
  verbose?: boolean;
};

const formatGitSummary = (result: InitResult) => {
  switch (result.gitAction) {
    case "cloned":
      return `cloned from ${result.gitSource}`;
    case "initialized":
      return "initialized new repository";
    default:
      return "using existing repository";
  }
};

const formatAgeSummary = (result: InitResult) => {
  return result.generatedIdentity
    ? "generated a new local identity"
    : "using existing identity";
};

const initCommand = buildCommand<InitFlags, [string?], DevsyncCliContext>({
  docs: {
    brief: "Initialize the git-backed sync directory",
    fullDescription:
      "Create or connect the local devsync repository under your XDG config directory, then store the sync settings used by later pull and push operations. If you omit the repository argument, devsync initializes a local git repository in the sync directory.",
  },
  async func(flags, repository) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;
    const requestedKey = flags.key?.trim();
    const configuredIdentityFile =
      flags.identity?.trim() || defaultSyncIdentityFile;
    const identityFile = resolveConfiguredIdentityFile(
      configuredIdentityFile,
      ENV,
      {
        source: "Requested identity file",
      },
    );
    const shouldPrompt =
      requestedKey === undefined && !(await pathExists(identityFile));
    const promptedKey = shouldPrompt
      ? await consola.prompt(
          "Enter an age private key (leave empty to generate a new one): ",
          { type: "text", cancel: "reject" },
        )
      : undefined;
    const trimmedPromptedKey = promptedKey?.trim();
    const result = await initializeSyncDirectory(
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
      reporter,
    );

    if (result.alreadyInitialized) {
      logger.info("Sync directory already initialized");
    } else {
      logger.success("Sync directory initialized");
    }

    logger.log(`  git: ${formatGitSummary(result)}`);
    logger.log(`  age: ${formatAgeSummary(result)}`);
    logger.log(
      `  ${result.entryCount} entries · ${result.recipientCount} recipients`,
    );

    if (verbose) {
      logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
      logger.log(pc.dim(`  config    ${result.configPath}`));
      logger.log(pc.dim(`  identity  ${result.identityFile}`));
    }
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
