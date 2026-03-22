import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  formatGlobalDevsyncConfig,
  type GlobalDevsyncConfig,
  readGlobalDevsyncConfig,
  resolveConfiguredIdentityFile,
} from "#app/config/global-config.ts";
import {
  createInitialSyncConfig,
  formatSyncConfig,
  parseSyncConfig,
  type ResolvedSyncConfigAge,
  readSyncConfig,
  resolveSyncArtifactsDirectoryPath,
} from "#app/config/sync.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";

import {
  createAgeIdentityFile,
  readAgeRecipientsFromIdentityFile,
} from "./crypto.ts";
import { DevsyncError, wrapUnknownError } from "./error.ts";
import { pathExists, writeTextFileAtomically } from "./filesystem.ts";
import { ensureRepository, initializeRepository } from "./git.ts";
import {
  ensureSyncRepository,
  resolveAgeFromSyncConfig,
  type SyncContext,
} from "./runtime.ts";

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
  age: ResolvedSyncConfigAge | undefined,
  request: SyncInitRequest,
  environment: NodeJS.ProcessEnv,
) => {
  if (age === undefined) {
    return;
  }

  const recipients = normalizeRecipients(request.recipients);

  if (
    recipients.length > 0 &&
    JSON.stringify(recipients) !==
      JSON.stringify(normalizeRecipients([...age.recipients]))
  ) {
    throw new DevsyncError(
      "Sync configuration already exists with different age recipients.",
      {
        code: "INIT_RECIPIENT_MISMATCH",
        details: [
          `Requested recipients: ${recipients.join(", ") || "(none)"}`,
          `Configured recipients: ${normalizeRecipients([...age.recipients]).join(", ")}`,
        ],
        hint: "Use the existing recipients, or update manifest.json manually if you intend to rotate recipients.",
      },
    );
  }

  if (
    request.identityFile === undefined ||
    request.identityFile.trim() === ""
  ) {
    return;
  }

  const resolvedIdentity = resolveConfiguredIdentityFile(
    request.identityFile,
    environment,
  );
  const configuredIdentity = resolveConfiguredIdentityFile(
    age.identityFile,
    environment,
  );

  if (resolvedIdentity !== configuredIdentity) {
    throw new DevsyncError(
      "Sync configuration already exists with a different age identity file.",
      {
        code: "INIT_IDENTITY_MISMATCH",
        details: [
          `Requested identity file: ${resolvedIdentity}`,
          `Configured identity file: ${configuredIdentity}`,
        ],
        hint: "Reuse the configured identity file, or update manifest.json before re-running init.",
      },
    );
  }
};

const writeGlobalSettings = async (
  configPath: string,
  config: GlobalDevsyncConfig,
) => {
  await mkdir(dirname(configPath), { recursive: true });
  await writeTextFileAtomically(configPath, formatGlobalDevsyncConfig(config));
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
    assertInitRequestMatchesConfig(config.age, request, context.environment);

    const age =
      config.age !== undefined
        ? resolveAgeFromSyncConfig(config.age, context.environment)
        : undefined;

    return {
      alreadyInitialized: true,
      configPath,
      entryCount: config.entries.length,
      gitAction: "existing",
      generatedIdentity: false,
      identityFile: age?.identityFile ?? "",
      recipientCount: age?.recipients.length ?? 0,
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
          "Sync directory already exists and is not empty.",
          {
            code: "SYNC_DIR_NOT_EMPTY",
            details: [`Sync directory: ${syncDirectory}`],
            hint: "Empty the directory, remove it, or point init at a different repository source.",
          },
        );
      }
    }

    const gitSourceInput = request.repository?.trim() || undefined;
    let gitResult: Awaited<ReturnType<typeof initializeRepository>>;

    try {
      gitResult = await initializeRepository(syncDirectory, gitSourceInput);
    } catch (error: unknown) {
      throw wrapUnknownError(
        gitSourceInput === undefined
          ? "Failed to initialize the sync repository."
          : "Failed to clone the sync repository.",
        error,
        {
          code:
            gitSourceInput === undefined
              ? "SYNC_INIT_GIT_FAILED"
              : "SYNC_CLONE_FAILED",
          details: [
            `Sync directory: ${syncDirectory}`,
            ...(gitSourceInput === undefined
              ? []
              : [`Repository source: ${gitSourceInput}`]),
          ],
          hint:
            gitSourceInput === undefined
              ? "Check that git is installed and the sync directory is writable."
              : "Check that the repository source is reachable and you have access to it.",
        },
      );
    }

    gitAction = gitResult.action;
    gitSource = gitResult.source;
  }

  await mkdir(resolveSyncArtifactsDirectoryPath(syncDirectory), {
    recursive: true,
  });

  if (await pathExists(configPath)) {
    const config = await readSyncConfig(syncDirectory, context.environment);
    assertInitRequestMatchesConfig(config.age, request, context.environment);

    const age =
      config.age !== undefined
        ? resolveAgeFromSyncConfig(config.age, context.environment)
        : undefined;

    return {
      alreadyInitialized: true,
      configPath,
      entryCount: config.entries.length,
      gitAction,
      ...(gitSource === undefined ? {} : { gitSource }),
      generatedIdentity: false,
      identityFile: age?.identityFile ?? "",
      recipientCount: age?.recipients.length ?? 0,
      syncDirectory,
    };
  }

  const ageBootstrap = await resolveInitAgeBootstrap(request, context);

  // Write global settings.json (without age)
  const existingGlobalConfig = await readGlobalDevsyncConfig(
    context.environment,
  );
  const globalConfigToWrite: GlobalDevsyncConfig = {
    activeMachine: existingGlobalConfig?.activeMachine ?? "default",
    version: 3,
  };
  await writeGlobalSettings(
    context.paths.globalConfigPath,
    globalConfigToWrite,
  );

  // Write sync manifest with age
  const initialConfig = createInitialSyncConfig({
    identityFile: ageBootstrap.configuredIdentityFile,
    recipients: [...new Set(ageBootstrap.recipients.map((r) => r.trim()))],
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
    syncDirectory,
  };
};
