import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CONSTANTS } from "#app/config/constants.ts";
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
  readSyncConfig,
  type SyncAgeConfig,
  syncConfigFileName,
} from "#app/config/sync.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";
import {
  createAgeIdentityFile,
  readAgeRecipientsFromIdentityFile,
  writeAgeIdentityFile,
} from "#app/lib/crypto.ts";
import { ENV } from "#app/lib/env.ts";
import { DevsyncError, wrapUnknownError } from "#app/lib/error.ts";
import { pathExists, writeTextFileAtomically } from "#app/lib/filesystem.ts";
import { ensureRepository, initializeRepository } from "#app/lib/git.ts";
import type { ProgressReporter } from "#app/lib/progress.ts";
import { reportPhase } from "#app/lib/progress.ts";
import {
  ensureSyncRepository,
  resolveAgeFromSyncConfig,
  resolveSyncPaths,
} from "./runtime.ts";

export type SyncInitRequest = Readonly<{
  ageIdentity?: string;
  generateAgeIdentity?: boolean;
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

export const defaultSyncIdentityFile = CONSTANTS.INIT.DEFAULT_IDENTITY_FILE;

const normalizeRecipients = (recipients: readonly string[]) => {
  return [
    ...new Set(recipients.map((recipient) => recipient.trim()).filter(Boolean)),
  ].sort((left, right) => {
    return left.localeCompare(right);
  });
};

const resolveInitAgeBootstrap = async (
  request: SyncInitRequest,
  reporter?: ProgressReporter,
) => {
  const configuredIdentityFile =
    request.identityFile?.trim() || defaultSyncIdentityFile;
  const identityFile = resolveConfiguredAbsolutePath(
    configuredIdentityFile,
    ENV,
  );
  const explicitRecipients = normalizeRecipients(request.recipients);

  if (request.ageIdentity !== undefined) {
    reportPhase(reporter, "Writing age identity file...");
    const { recipient } = await writeAgeIdentityFile(
      identityFile,
      request.ageIdentity,
    );

    return {
      configuredIdentityFile,
      generatedIdentity: false,
      recipients: normalizeRecipients([...explicitRecipients, recipient]),
    };
  }

  if (explicitRecipients.length === 0) {
    if (await pathExists(identityFile)) {
      reportPhase(
        reporter,
        "Loading age recipients from the existing identity...",
      );
      return {
        configuredIdentityFile,
        generatedIdentity: false,
        recipients: normalizeRecipients(
          await readAgeRecipientsFromIdentityFile(identityFile),
        ),
      };
    }

    reportPhase(reporter, "Generating a new age identity...");
    const { recipient } = await createAgeIdentityFile(identityFile);

    return {
      configuredIdentityFile,
      generatedIdentity: true,
      recipients: [recipient],
    };
  }

  if (request.generateAgeIdentity === true) {
    reportPhase(reporter, "Generating a new age identity...");
    const { recipient } = await createAgeIdentityFile(identityFile);

    return {
      configuredIdentityFile,
      generatedIdentity: true,
      recipients: normalizeRecipients([...explicitRecipients, recipient]),
    };
  }

  if (await pathExists(identityFile)) {
    reportPhase(reporter, "Using the existing age identity file...");
    return {
      configuredIdentityFile,
      generatedIdentity: false,
      recipients: explicitRecipients,
    };
  }

  reportPhase(reporter, "Generating a new age identity...");
  const { recipient } = await createAgeIdentityFile(identityFile);

  return {
    configuredIdentityFile,
    generatedIdentity: true,
    recipients: normalizeRecipients([...explicitRecipients, recipient]),
  };
};

const assertInitRequestMatchesConfig = (
  age: SyncAgeConfig | undefined,
  request: SyncInitRequest,
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
        hint: `Use the existing recipients, or update ${syncConfigFileName} manually if you intend to rotate recipients.`,
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
    ENV,
  );
  const configuredIdentity = resolveConfiguredIdentityFile(
    age.identityFile,
    ENV,
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
        hint: `Reuse the configured identity file, or update ${syncConfigFileName} before re-running init.`,
      },
    );
  }
};

const buildAlreadyInitializedResult = (
  config: Awaited<ReturnType<typeof readSyncConfig>>,
  base: Readonly<{
    configPath: string;
    gitAction: SyncInitResult["gitAction"];
    gitSource?: string;
    syncDirectory: string;
  }>,
): SyncInitResult => {
  const age =
    config.age !== undefined ? resolveAgeFromSyncConfig(config.age) : undefined;

  return {
    alreadyInitialized: true,
    configPath: base.configPath,
    entryCount: config.entries.length,
    gitAction: base.gitAction,
    ...(base.gitSource === undefined ? {} : { gitSource: base.gitSource }),
    generatedIdentity: false,
    identityFile: age?.identityFile ?? "",
    recipientCount: age?.recipients.length ?? 0,
    syncDirectory: base.syncDirectory,
  };
};

const writeGlobalSettings = async (globalConfigPath: string) => {
  const existingGlobalConfig = await readGlobalDevsyncConfig();
  const globalConfigToWrite: GlobalDevsyncConfig = {
    activeProfile:
      existingGlobalConfig?.activeProfile ?? CONSTANTS.SYNC.DEFAULT_PROFILE,
    version: CONSTANTS.GLOBAL_CONFIG.CURRENT_VERSION,
  };

  await mkdir(dirname(globalConfigPath), { recursive: true });
  await writeTextFileAtomically(
    globalConfigPath,
    formatGlobalDevsyncConfig(globalConfigToWrite),
  );
};

export const initializeSync = async (
  request: SyncInitRequest,
  reporter?: ProgressReporter,
): Promise<SyncInitResult> => {
  reportPhase(reporter, "Initializing sync directory...");
  const { syncDirectory, configPath, globalConfigPath } = resolveSyncPaths();
  const configExists = await pathExists(configPath);

  if (configExists) {
    reportPhase(reporter, "Checking the existing sync repository...");
    await ensureSyncRepository(syncDirectory);

    reportPhase(reporter, "Loading the existing sync manifest...");
    const config = await readSyncConfig(syncDirectory, ENV);
    assertInitRequestMatchesConfig(config.age, request);

    await resolveInitAgeBootstrap(request, reporter);

    return buildAlreadyInitializedResult(config, {
      configPath,
      gitAction: "existing",
      syncDirectory,
    });
  }

  await mkdir(dirname(syncDirectory), {
    recursive: true,
  });
  reportPhase(reporter, "Preparing the sync directory...");

  let gitAction: SyncInitResult["gitAction"] = "existing";
  let gitSource: string | undefined;

  try {
    reportPhase(reporter, "Checking for an existing git repository...");
    await ensureRepository(syncDirectory);
    reportPhase(reporter, "Using the existing git repository...");
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
      reportPhase(
        reporter,
        gitSourceInput === undefined
          ? "Initializing a new git repository..."
          : `Cloning the sync repository from ${gitSourceInput}...`,
      );
      gitResult = await initializeRepository(
        syncDirectory,
        gitSourceInput,
        reporter,
      );
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

  reportPhase(reporter, "Preparing the sync artifact directory...");
  await mkdir(syncDirectory, { recursive: true });

  if (await pathExists(configPath)) {
    reportPhase(reporter, "Loading the existing sync manifest...");
    const config = await readSyncConfig(syncDirectory, ENV);
    assertInitRequestMatchesConfig(config.age, request);

    const ageBootstrap = await resolveInitAgeBootstrap(request, reporter);

    if (configExists) {
      return buildAlreadyInitializedResult(config, {
        configPath,
        gitAction,
        gitSource,
        syncDirectory,
      });
    }

    reportPhase(reporter, "Writing global devsync settings...");
    await writeGlobalSettings(globalConfigPath);

    const age =
      config.age !== undefined
        ? resolveAgeFromSyncConfig(config.age)
        : undefined;

    return {
      alreadyInitialized: false,
      configPath,
      entryCount: config.entries.length,
      gitAction,
      ...(gitSource === undefined ? {} : { gitSource }),
      generatedIdentity: ageBootstrap.generatedIdentity,
      identityFile:
        age?.identityFile ??
        resolveConfiguredAbsolutePath(ageBootstrap.configuredIdentityFile, ENV),
      recipientCount: age?.recipients.length ?? 0,
      syncDirectory,
    };
  }

  reportPhase(reporter, "Preparing sync encryption settings...");
  const ageBootstrap = await resolveInitAgeBootstrap(request, reporter);

  // Write global settings.json (without age)
  reportPhase(reporter, "Writing global devsync settings...");
  await writeGlobalSettings(globalConfigPath);

  // Write sync manifest with age
  const initialConfig = createInitialSyncConfig({
    identityFile: ageBootstrap.configuredIdentityFile,
    recipients: [...new Set(ageBootstrap.recipients.map((r) => r.trim()))],
  });

  reportPhase(reporter, "Writing sync manifest...");
  parseSyncConfig(initialConfig, ENV);
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
      ENV,
    ),
    recipientCount: ageBootstrap.recipients.length,
    syncDirectory,
  };
};
