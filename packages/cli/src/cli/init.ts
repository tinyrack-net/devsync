import { readFile } from "node:fs/promises";
import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { resolveDefaultIdentityFile } from "#app/config/identity-file.ts";
import { resolveDotweaveHomeDirectoryFromEnv } from "#app/config/runtime-env.ts";
import { pathExists } from "#app/lib/filesystem.ts";
import { ask } from "#app/lib/prompt.ts";
import {
  createMissingRepositoryAgeKeyError,
  type InitResult,
  initializeSyncDirectory,
} from "#app/services/init.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";

type InitFlags = {
  force?: boolean;
  keyFile?: string;
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

const initCommand = buildCommand<InitFlags, [string?], ApplicationContext>({
  docs: {
    brief: "Initialize the git-backed sync directory",
    fullDescription:
      "Create or connect the local dotweave repository under your dotweave app-data directory, then store the sync settings used by later pull and push operations. If local sync repository data already exists, init fails unless --force is provided. If you omit the repository argument, dotweave initializes a local git repository in the sync directory.",
  },
  async func(flags, repository) {
    const logger = createCliLogger();
    const keyFileContents =
      flags.keyFile === undefined
        ? undefined
        : await readFile(flags.keyFile, "utf8");
    const requestedKey = keyFileContents?.trim() || undefined;
    const keyFileProvided = flags.keyFile !== undefined;
    const identityFile = resolveDefaultIdentityFile(
      resolveDotweaveHomeDirectoryFromEnv(),
    );
    const identityFileExists = await pathExists(identityFile);
    const effectiveIdentityFileExists =
      flags.force === true ? false : identityFileExists;
    const importingRepository =
      repository !== undefined && repository.trim() !== "";
    const shouldPrompt =
      requestedKey === undefined &&
      !keyFileProvided &&
      !effectiveIdentityFileExists &&
      importingRepository;
    const promptedKey = shouldPrompt
      ? await ask(
          importingRepository
            ? "Enter the age private key for the existing repository: "
            : "Enter an age private key (leave empty to generate a new one): ",
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

    const spin = logger.spinner(
      importingRepository
        ? "Cloning repository..."
        : "Initializing sync directory...",
    );

    const result = await initializeSyncDirectory({
      ageIdentity:
        requestedKey !== undefined
          ? requestedKey
          : trimmedPromptedKey !== undefined && trimmedPromptedKey !== ""
            ? trimmedPromptedKey
            : undefined,
      force: flags.force === true,
      generateAgeIdentity:
        !importingRepository &&
        requestedKey === undefined &&
        (trimmedPromptedKey === "" ||
          (trimmedPromptedKey === undefined && !effectiveIdentityFileExists)),
      recipients: [],
      repository,
    });

    if (result.alreadyInitialized) {
      spin.stop();
      logger.info("Sync directory already initialized");
    } else {
      spin.succeed("Sync directory initialized");
    }

    logger.kv("git", formatGitSummary(result));
    logger.kv("age", formatAgeSummary(result));
    logger.log(
      `  ${result.entryCount} entries · ${result.recipientCount} recipients`,
    );
  },
  parameters: {
    flags: {
      force: {
        brief:
          "Replace existing local sync repository, identity, and settings before initializing",
        kind: "boolean",
        optional: true,
      },
      keyFile: {
        brief: "Read an age private key from a file",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "path",
      },
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
