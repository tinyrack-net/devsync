import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  createInitialSyncConfig,
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncConfigFilePath,
  resolveSyncPlainDirectoryPath,
  resolveSyncSecretDirectoryPath,
} from "#app/config/sync.ts";
import {
  resolveConfiguredAbsolutePath,
  resolveDevtoolsSyncDirectory,
} from "#app/config/xdg.ts";

import { countConfiguredRules } from "./config-file.ts";
import {
  createAgeIdentityFile,
  readAgeRecipientsFromIdentityFile,
} from "./crypto.ts";
import { SyncError } from "./error.ts";
import { pathExists } from "./filesystem.ts";
import { ensureGitRepository, type GitService } from "./git.ts";

type SyncInitRequest = Readonly<{
  identityFile?: string;
  recipients: readonly string[];
  repository?: string;
}>;

type SyncInitResult = Readonly<{
  alreadyInitialized: boolean;
  configPath: string;
  entryCount: number;
  gitAction: "cloned" | "existing" | "initialized";
  gitSource?: string;
  identityFile: string;
  generatedIdentity: boolean;
  recipientCount: number;
  ruleCount: number;
  syncDirectory: string;
}>;

const defaultSyncIdentityFile = "$XDG_CONFIG_HOME/devtools/age/keys.txt";

const normalizeRecipients = (recipients: readonly string[]) => {
  return [
    ...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean)),
  ].sort((left, right) => {
    return left.localeCompare(right);
  });
};

const resolveInitAgeBootstrap = async (
  request: SyncInitRequest,
  environment: NodeJS.ProcessEnv,
) => {
  const configuredIdentityFile =
    request.identityFile?.trim() || defaultSyncIdentityFile;
  const identityFile = resolveConfiguredAbsolutePath(
    configuredIdentityFile,
    environment,
  );
  const explicitRecipients = normalizeRecipients(request.recipients);

  if (explicitRecipients.length === 0) {
    if (await pathExists(identityFile)) {
      return {
        configuredIdentityFile,
        generatedIdentity: false,
        recipients: normalizeRecipients(
          await readAgeRecipientsFromIdentityFile(identityFile),
        ),
      };
    }

    const { recipient } = await createAgeIdentityFile(identityFile);

    return {
      configuredIdentityFile,
      generatedIdentity: true,
      recipients: [recipient],
    };
  }

  if (await pathExists(identityFile)) {
    return {
      configuredIdentityFile,
      generatedIdentity: false,
      recipients: explicitRecipients,
    };
  }

  const { recipient } = await createAgeIdentityFile(identityFile);

  return {
    configuredIdentityFile,
    generatedIdentity: true,
    recipients: normalizeRecipients([...explicitRecipients, recipient]),
  };
};

const assertInitRequestMatchesConfig = (
  config: ResolvedSyncConfig,
  request: SyncInitRequest,
  environment: NodeJS.ProcessEnv,
) => {
  const recipients = normalizeRecipients(request.recipients);

  if (
    recipients.length > 0 &&
    JSON.stringify(recipients) !==
      JSON.stringify(normalizeRecipients(config.age.recipients))
  ) {
    throw new SyncError(
      "Sync configuration already exists with different recipients.",
    );
  }

  if (
    request.identityFile === undefined ||
    request.identityFile.trim() === ""
  ) {
    return;
  }

  const resolvedIdentity = resolveConfiguredAbsolutePath(
    request.identityFile,
    environment,
  );

  if (resolvedIdentity !== config.age.identityFile) {
    throw new SyncError(
      "Sync configuration already exists with a different identity file.",
    );
  }
};

export const initializeSync = async (
  request: SyncInitRequest,
  dependencies: Readonly<{
    environment: NodeJS.ProcessEnv;
    git: GitService;
  }>,
): Promise<SyncInitResult> => {
  try {
    const syncDirectory = resolveDevtoolsSyncDirectory(
      dependencies.environment,
    );
    const configPath = resolveSyncConfigFilePath(syncDirectory);
    const configExists = await pathExists(configPath);

    if (configExists) {
      await ensureGitRepository(syncDirectory, dependencies.git);

      const config = await readSyncConfig(
        syncDirectory,
        dependencies.environment,
      );
      assertInitRequestMatchesConfig(config, request, dependencies.environment);

      return {
        alreadyInitialized: true,
        configPath,
        entryCount: config.entries.length,
        gitAction: "existing",
        generatedIdentity: false,
        identityFile: config.age.identityFile,
        recipientCount: config.age.recipients.length,
        ruleCount: countConfiguredRules(config),
        syncDirectory,
      };
    }

    await mkdir(dirname(syncDirectory), { recursive: true });

    let gitAction: SyncInitResult["gitAction"] = "existing";
    let gitSource: string | undefined;

    try {
      await dependencies.git.ensureRepository(syncDirectory);
    } catch {
      const syncDirectoryExists = await pathExists(syncDirectory);

      if (syncDirectoryExists) {
        const entries = await readdir(syncDirectory);

        if (entries.length > 0) {
          throw new SyncError(
            `Sync directory already exists and is not empty: ${syncDirectory}`,
          );
        }
      }

      const gitResult = await dependencies.git.initializeRepository(
        syncDirectory,
        request.repository?.trim() || undefined,
      );

      gitAction = gitResult.action;
      gitSource = gitResult.source;
    }

    await mkdir(resolveSyncPlainDirectoryPath(syncDirectory), {
      recursive: true,
    });
    await mkdir(resolveSyncSecretDirectoryPath(syncDirectory), {
      recursive: true,
    });

    if (await pathExists(configPath)) {
      const config = await readSyncConfig(
        syncDirectory,
        dependencies.environment,
      );

      assertInitRequestMatchesConfig(config, request, dependencies.environment);

      return {
        alreadyInitialized: true,
        configPath,
        entryCount: config.entries.length,
        gitAction,
        ...(gitSource === undefined ? {} : { gitSource }),
        generatedIdentity: false,
        identityFile: config.age.identityFile,
        recipientCount: config.age.recipients.length,
        ruleCount: countConfiguredRules(config),
        syncDirectory,
      };
    }

    const ageBootstrap = await resolveInitAgeBootstrap(
      request,
      dependencies.environment,
    );

    const initialConfig = createInitialSyncConfig({
      identityFile: ageBootstrap.configuredIdentityFile,
      recipients: ageBootstrap.recipients,
    });

    parseSyncConfig(initialConfig, dependencies.environment);
    await writeFile(configPath, formatSyncConfig(initialConfig), "utf8");

    return {
      alreadyInitialized: false,
      configPath,
      entryCount: 0,
      gitAction,
      ...(gitSource === undefined ? {} : { gitSource }),
      generatedIdentity: ageBootstrap.generatedIdentity,
      identityFile: resolveConfiguredAbsolutePath(
        ageBootstrap.configuredIdentityFile,
        dependencies.environment,
      ),
      recipientCount: ageBootstrap.recipients.length,
      ruleCount: 0,
      syncDirectory,
    };
  } catch (error: unknown) {
    if (error instanceof SyncError) {
      throw error;
    }

    throw new SyncError(
      error instanceof Error ? error.message : "Sync initialization failed.",
    );
  }
};
