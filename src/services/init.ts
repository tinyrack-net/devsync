import { mkdir, readdir, writeFile } from "node:fs/promises";
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
import {
  createAgeIdentityFile,
  readAgeRecipientsFromIdentityFile,
} from "./crypto.ts";
import { DevsyncError } from "./error.ts";
import { pathExists } from "./filesystem.ts";
import { ensureRepository, initializeRepository } from "./git.ts";
import { ensureSyncRepository, type SyncContext } from "./runtime.ts";

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
  context: Pick<SyncContext, "environment">,
) => {
  const configuredIdentityFile =
    request.identityFile?.trim() || defaultSyncIdentityFile;
  const identityFile = resolveConfiguredAbsolutePath(
    configuredIdentityFile,
    context.environment,
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
    throw new DevsyncError(
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
    throw new DevsyncError(
      "Sync configuration already exists with a different identity file.",
    );
  }
};

export const initializeSync = async (
  request: SyncInitRequest,
  context: SyncContext,
): Promise<SyncInitResult> => {
  const syncDirectory = context.paths.syncDirectory;
  const configPath = context.paths.configPath;
  const configExists = await pathExists(configPath);

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

  await mkdir(dirname(syncDirectory), {
    recursive: true,
  });

  let gitAction: SyncInitResult["gitAction"] = "existing";
  let gitSource: string | undefined;

  try {
    await ensureRepository(syncDirectory);
  } catch {
    const syncDirectoryExists = await pathExists(syncDirectory);

    if (syncDirectoryExists) {
      const entries = await readdir(syncDirectory);

      if (entries.length > 0) {
        throw new DevsyncError(
          `Sync directory already exists and is not empty: ${syncDirectory}`,
        );
      }
    }

    const gitResult = await initializeRepository(
      syncDirectory,
      request.repository?.trim() || undefined,
    );

    gitAction = gitResult.action;
    gitSource = gitResult.source;
  }

  await mkdir(resolveSyncArtifactsDirectoryPath(syncDirectory), {
    recursive: true,
  });

  if (await pathExists(configPath)) {
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
      context.environment,
    ),
    recipientCount: ageBootstrap.recipients.length,
    ruleCount: 0,
    syncDirectory,
  };
};
