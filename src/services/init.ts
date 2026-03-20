import { dirname } from "node:path";

import {
  createInitialSyncConfig,
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfig,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";

import { countConfiguredRules } from "./config-file.ts";
import { SyncError } from "./error.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";
import { runSyncUseCase } from "./use-case.ts";

export type SyncInitRequest = Readonly<{
  identityFile?: string;
  recipients: readonly string[];
  repository?: string;
}>;

export type SyncInitResult = Readonly<{
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

const defaultSyncIdentityFile = "$XDG_CONFIG_HOME/devsync/age/keys.txt";

const normalizeRecipients = (recipients: readonly string[]) => {
  return [
    ...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean)),
  ].sort((left, right) => {
    return left.localeCompare(right);
  });
};

const resolveInitAgeBootstrap = async (
  request: SyncInitRequest,
  context: Pick<SyncContext, "environment" | "ports">,
) => {
  const configuredIdentityFile =
    request.identityFile?.trim() || defaultSyncIdentityFile;
  const identityFile = resolveConfiguredAbsolutePath(
    configuredIdentityFile,
    context.environment,
  );
  const explicitRecipients = normalizeRecipients(request.recipients);

  if (explicitRecipients.length === 0) {
    if (await context.ports.filesystem.pathExists(identityFile)) {
      return {
        configuredIdentityFile,
        generatedIdentity: false,
        recipients: normalizeRecipients(
          await context.ports.crypto.readAgeRecipientsFromIdentityFile(
            identityFile,
          ),
        ),
      };
    }

    const { recipient } =
      await context.ports.crypto.createAgeIdentityFile(identityFile);

    return {
      configuredIdentityFile,
      generatedIdentity: true,
      recipients: [recipient],
    };
  }

  if (await context.ports.filesystem.pathExists(identityFile)) {
    return {
      configuredIdentityFile,
      generatedIdentity: false,
      recipients: explicitRecipients,
    };
  }

  const { recipient } =
    await context.ports.crypto.createAgeIdentityFile(identityFile);

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
  context: SyncContext,
): Promise<SyncInitResult> => {
  return runSyncUseCase("Sync initialization failed.", async () => {
    const syncDirectory = context.paths.syncDirectory;
    const configPath = context.paths.configPath;
    const configExists = await context.ports.filesystem.pathExists(configPath);

    if (configExists) {
      await ensureSyncRepository(context);

      const config = await readSyncConfig(syncDirectory, context.environment);
      assertInitRequestMatchesConfig(config, request, context.environment);

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

    await context.ports.filesystem.mkdir(dirname(syncDirectory), {
      recursive: true,
    });

    let gitAction: SyncInitResult["gitAction"] = "existing";
    let gitSource: string | undefined;

    try {
      await context.ports.git.ensureRepository(syncDirectory);
    } catch {
      const syncDirectoryExists =
        await context.ports.filesystem.pathExists(syncDirectory);

      if (syncDirectoryExists) {
        const entries = await context.ports.filesystem.readdir(syncDirectory);

        if (entries.length > 0) {
          throw new SyncError(
            `Sync directory already exists and is not empty: ${syncDirectory}`,
          );
        }
      }

      const gitResult = await context.ports.git.initializeRepository(
        syncDirectory,
        request.repository?.trim() || undefined,
      );

      gitAction = gitResult.action;
      gitSource = gitResult.source;
    }

    await context.ports.filesystem.mkdir(
      resolveSyncArtifactsDirectoryPath(syncDirectory),
      {
        recursive: true,
      },
    );

    if (await context.ports.filesystem.pathExists(configPath)) {
      const config = await readSyncConfig(syncDirectory, context.environment);

      assertInitRequestMatchesConfig(config, request, context.environment);

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

    const ageBootstrap = await resolveInitAgeBootstrap(request, context);

    const initialConfig = createInitialSyncConfig({
      identityFile: ageBootstrap.configuredIdentityFile,
      recipients: ageBootstrap.recipients,
    });

    parseSyncConfig(initialConfig, context.environment);
    await context.ports.filesystem.writeFile(
      configPath,
      formatSyncConfig(initialConfig),
      "utf8",
    );

    return {
      alreadyInitialized: false,
      configPath,
      entryCount: 0,
      gitAction,
      ...(gitSource === undefined ? {} : { gitSource }),
      generatedIdentity: ageBootstrap.generatedIdentity,
      identityFile: resolveConfiguredAbsolutePath(
        ageBootstrap.configuredIdentityFile,
        context.environment,
      ),
      recipientCount: ageBootstrap.recipients.length,
      ruleCount: 0,
      syncDirectory,
    };
  });
};
