import { buildCommand } from "@stricli/core";
import consola from "consola";
import pc from "picocolors";
import { resolveDefaultIdentityFile } from "#app/config/identity-file.ts";
import { readEnvValue } from "#app/config/runtime-env.ts";
import { pathExists } from "#app/lib/filesystem.ts";
import {
  createMissingRepositoryAgeKeyError,
  type InitResult,
  initializeSyncDirectory,
} from "#app/services/init.ts";
import {
  type DotweaveCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type InitFlags = {
  key?: string;
  promptKey?: boolean;
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

const initCommand = buildCommand<InitFlags, [string?], DotweaveCliContext>({
  docs: {
    brief: "Initialize the git-backed sync directory",
    fullDescription:
      "Create or connect the local dotweave repository under your XDG config directory, then store the sync settings used by later pull and push operations. If you omit the repository argument, dotweave initializes a local git repository in the sync directory.",
  },
  async func(flags, repository) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const reporter = verbose ? logger : undefined;
    const requestedKey = flags.key?.trim();
    const identityFile = resolveDefaultIdentityFile(
      readEnvValue("HOME"),
      readEnvValue("XDG_CONFIG_HOME"),
    );
    const identityFileExists = await pathExists(identityFile);
    const importingRepository =
      repository !== undefined && repository.trim() !== "";
    const shouldPrompt =
      requestedKey === undefined &&
      !identityFileExists &&
      ((flags.promptKey ?? false) || importingRepository);
    const promptedKey = shouldPrompt
      ? await consola.prompt(
          importingRepository
            ? "Enter the age private key for the existing repository: "
            : "Enter an age private key (leave empty to generate a new one): ",
          { type: "text", cancel: "reject" },
        )
      : undefined;
    const trimmedPromptedKey = promptedKey?.trim();
    if (
      importingRepository &&
      requestedKey === undefined &&
      trimmedPromptedKey === ""
    ) {
      throw createMissingRepositoryAgeKeyError();
    }
    const result = await initializeSyncDirectory(
      {
        ageIdentity:
          requestedKey !== undefined
            ? requestedKey
            : trimmedPromptedKey !== undefined && trimmedPromptedKey !== ""
              ? trimmedPromptedKey
              : undefined,
        generateAgeIdentity:
          !importingRepository &&
          requestedKey === undefined &&
          (trimmedPromptedKey === "" ||
            (trimmedPromptedKey === undefined && !identityFileExists)),
        recipients: [],
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
      key: {
        brief: "Persist an age private key into the identity file",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "age-private-key",
      },
      promptKey: {
        brief:
          "Prompt to enter an age private key instead of generating one automatically",
        kind: "boolean",
        optional: true,
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
