import { CONSTANTS } from "#app/config/constants.ts";
import { resolveConfiguredAbsolutePath } from "#app/config/xdg.ts";
import { DotweaveError } from "#app/lib/error.ts";

export type ResolveConfiguredIdentityFileOptions = Readonly<{
  configPath?: string;
  hint?: string;
  source?: string;
}>;

const defaultIdentityFileSource = "Configured identity file";

export const resolveDefaultIdentityFile = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  return resolveConfiguredAbsolutePath(
    CONSTANTS.INIT.DEFAULT_IDENTITY_FILE,
    home,
    xdgConfigHome,
  );
};

export const resolveLegacyIdentityFile = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  return resolveConfiguredAbsolutePath(
    CONSTANTS.INIT.LEGACY_IDENTITY_FILE,
    home,
    xdgConfigHome,
  );
};

export const resolveConfiguredIdentityFile = (
  value: string,
  home: string | undefined,
  xdgConfigHome: string | undefined,
  options: ResolveConfiguredIdentityFileOptions = {},
) => {
  const configuredIdentityFile = value.trim();
  const source = options.source ?? defaultIdentityFileSource;

  let resolvedIdentityFile: string;

  try {
    resolvedIdentityFile = resolveConfiguredAbsolutePath(
      configuredIdentityFile,
      home,
      xdgConfigHome,
    );
  } catch (error: unknown) {
    throw new DotweaveError(
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

  if (resolvedIdentityFile === resolveLegacyIdentityFile(home, xdgConfigHome)) {
    throw new DotweaveError(
      "Configured age identity file uses the removed legacy path.",
      {
        code: "AGE_IDENTITY_LEGACY_PATH",
        details: [
          `${source}: ${configuredIdentityFile}`,
          ...(options.configPath === undefined
            ? []
            : [`Config file: ${options.configPath}`]),
          `Resolved identity file: ${resolvedIdentityFile}`,
          `Supported identity file: ${resolveDefaultIdentityFile(home, xdgConfigHome)}`,
        ],
        hint:
          options.hint ??
          `Update the identity file path to ${CONSTANTS.INIT.DEFAULT_IDENTITY_FILE}.`,
      },
    );
  }

  return resolvedIdentityFile;
};
