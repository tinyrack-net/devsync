import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { AppConstants } from "#app/config/constants.ts";
import { normalizeConfiguredValue } from "#app/lib/string.ts";

export const resolveHomeDirectory = (home: string | undefined) => {
  const configuredValue = normalizeConfiguredValue(home);

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(homedir());
};

export const resolveXdgConfigHome = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  const configuredValue = normalizeConfiguredValue(xdgConfigHome);

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(resolveHomeDirectory(home), ".config");
};

export const resolveDotweaveConfigDirectory = (xdgConfigHome: string) => {
  return resolve(xdgConfigHome, AppConstants.XDG.APP_DIRECTORY_NAME);
};

type DotweaveHomePlatform = NodeJS.Platform;

type DotweaveHomeDirectoryOptions = {
  appData?: string;
  dotweaveHome?: string;
  home?: string;
  localAppData?: string;
  osHomeDirectory?: string;
  platform: DotweaveHomePlatform;
  userProfile?: string;
  xdgConfigHome?: string;
};

export const resolveDotweaveHomeDirectory = ({
  appData,
  dotweaveHome,
  home,
  localAppData,
  osHomeDirectory,
  platform,
  userProfile,
  xdgConfigHome,
}: DotweaveHomeDirectoryOptions) => {
  const configuredDotweaveHome = normalizeConfiguredValue(dotweaveHome);

  if (configuredDotweaveHome !== undefined) {
    return resolve(configuredDotweaveHome);
  }

  if (platform === "win32") {
    const configuredAppData = normalizeConfiguredValue(appData);
    if (configuredAppData !== undefined) {
      return resolve(configuredAppData, AppConstants.XDG.APP_DIRECTORY_NAME);
    }

    const configuredLocalAppData = normalizeConfiguredValue(localAppData);
    if (configuredLocalAppData !== undefined) {
      return resolve(
        configuredLocalAppData,
        AppConstants.XDG.APP_DIRECTORY_NAME,
      );
    }

    const configuredUserProfile = normalizeConfiguredValue(userProfile);
    if (configuredUserProfile !== undefined) {
      return resolve(
        configuredUserProfile,
        "AppData",
        "Roaming",
        AppConstants.XDG.APP_DIRECTORY_NAME,
      );
    }

    return resolve(
      normalizeConfiguredValue(osHomeDirectory) ?? homedir(),
      "AppData",
      "Roaming",
      AppConstants.XDG.APP_DIRECTORY_NAME,
    );
  }

  return resolveDotweaveConfigDirectory(
    resolveXdgConfigHome(home, xdgConfigHome),
  );
};

export const resolveDotweaveGlobalConfigFilePath = (
  dotweaveConfigDirectory: string,
) => {
  return resolve(dotweaveConfigDirectory, AppConstants.GLOBAL_CONFIG.FILE_NAME);
};

export const resolveDotweaveSyncDirectory = (
  dotweaveConfigDirectory: string,
) => {
  return resolve(dotweaveConfigDirectory, AppConstants.XDG.SYNC_DIRECTORY_NAME);
};

export const expandHomePath = (value: string, home: string | undefined) => {
  let expandedValue = value.trim();
  const homeDirectory = resolveHomeDirectory(home);

  if (expandedValue === "~") {
    expandedValue = homeDirectory;
  } else if (expandedValue.startsWith("~/")) {
    expandedValue = resolve(homeDirectory, expandedValue.slice(2));
  }

  return expandedValue;
};

export const expandConfiguredPath = (
  value: string,
  home: string | undefined,
  xdgConfigHome: string | undefined,
  readEnv?: (name: string) => string | undefined,
) => {
  let expandedValue = value.trim();

  if (readEnv !== undefined && expandedValue.includes("%")) {
    expandedValue = expandWindowsEnvVars(expandedValue, readEnv);
  }

  expandedValue = expandHomePath(expandedValue, home);
  const resolvedXdgConfigHome = resolveXdgConfigHome(home, xdgConfigHome);

  const xdgMatch = expandedValue.match(
    /^\$(?:\{XDG_CONFIG_HOME\}|XDG_CONFIG_HOME)(?:\/(.*))?$/,
  );
  if (xdgMatch) {
    expandedValue =
      xdgMatch[1] != null
        ? resolve(resolvedXdgConfigHome, xdgMatch[1])
        : resolvedXdgConfigHome;
  }

  return expandedValue;
};

export const resolveConfiguredAbsolutePath = (
  value: string,
  home: string | undefined,
  xdgConfigHome: string | undefined,
  readEnv?: (name: string) => string | undefined,
) => {
  const expandedValue = expandConfiguredPath(
    value,
    home,
    xdgConfigHome,
    readEnv,
  );

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~ or $XDG_CONFIG_HOME: ${value}`,
    );
  }

  return resolve(expandedValue);
};

export const expandWindowsEnvVars = (
  value: string,
  readEnv: (name: string) => string | undefined,
): string => {
  return value.replace(/%([^%]+)%/g, (_match, varName: string) => {
    const envValue = normalizeConfiguredValue(readEnv(varName));

    if (envValue === undefined) {
      throw new Error(`Environment variable %${varName}% is not defined.`);
    }

    return envValue;
  });
};
