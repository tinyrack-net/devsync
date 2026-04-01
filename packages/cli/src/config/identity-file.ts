import { CONSTANTS } from "#app/config/constants.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";
import { ENV, type Env } from "#app/lib/env.ts";
import { DevsyncError } from "#app/lib/error.ts";

export type ResolveConfiguredIdentityFileOptions = Readonly<{
  configPath?: string;
  hint?: string;
  source?: string;
}>;

const defaultIdentityFileSource = "Configured identity file";

export const resolveDefaultIdentityFile = (environment: Env = ENV) => {
  return resolveConfiguredAbsolutePath(
    CONSTANTS.INIT.DEFAULT_IDENTITY_FILE,
    environment,
  );
};

export const resolveLegacyIdentityFile = (environment: Env = ENV) => {
  return resolveConfiguredAbsolutePath(
    CONSTANTS.INIT.LEGACY_IDENTITY_FILE,
    environment,
  );
};

export const resolveConfiguredIdentityFile = (
  value: string,
  environment: Env = ENV,
  options: ResolveConfiguredIdentityFileOptions = {},
) => {
  const configuredIdentityFile = value.trim();
  const source = options.source ?? defaultIdentityFileSource;

  let resolvedIdentityFile: string;

  try {
    resolvedIdentityFile = resolveConfiguredAbsolutePath(
      configuredIdentityFile,
      environment,
    );
  } catch (error: unknown) {
    throw new DevsyncError(
      error instanceof Error
        ? error.message
        : `Invalid age identity file path: ${value}`,
      {
        code: "AGE_IDENTITY_PATH_INVALID",
        details: [
          `${source}: ${configuredIdentityFile}`,
          ...(options.configPath === undefined
            ? []
            : [`Config file: ${options.configPath}`]),
        ],
      },
    );
  }

  if (resolvedIdentityFile === resolveLegacyIdentityFile(environment)) {
    throw new DevsyncError(
      "Configured age identity file uses the removed legacy path.",
      {
        code: "AGE_IDENTITY_LEGACY_PATH",
        details: [
          `${source}: ${configuredIdentityFile}`,
          ...(options.configPath === undefined
            ? []
            : [`Config file: ${options.configPath}`]),
          `Resolved identity file: ${resolvedIdentityFile}`,
          `Supported identity file: ${resolveDefaultIdentityFile(environment)}`,
        ],
        hint:
          options.hint ??
          `Update the identity file path to ${CONSTANTS.INIT.DEFAULT_IDENTITY_FILE}.`,
      },
    );
  }

  return resolvedIdentityFile;
};
