import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { CONSTANTS } from "#app/config/constants.ts";

const xdgConfigHomeToken = "$XDG_CONFIG_HOME";
const xdgConfigHomeTokenPrefix = `${xdgConfigHomeToken}/`;
const bracedXdgConfigHomeToken = "${XDG_CONFIG_HOME}";
const bracedXdgConfigHomePrefix = `${bracedXdgConfigHomeToken}/`;

const trimConfiguredValue = (value: string | undefined) => {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === "" ? undefined : trimmedValue;
};

const readTrimmedEnvironmentValue = (
  readEnv: (name: string) => string | undefined,
  key: string,
) => {
  const value = readEnv(key);

  return value === undefined ? undefined : trimConfiguredValue(value);
};

export const resolveHomeDirectory = (home: string | undefined) => {
  const configuredValue = trimConfiguredValue(home);

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(homedir());
};

export const resolveXdgConfigHome = (
  home: string | undefined,
  xdgConfigHome: string | undefined,
) => {
  const configuredValue = trimConfiguredValue(xdgConfigHome);

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(resolveHomeDirectory(home), ".config");
};

export const resolveDotweaveConfigDirectory = (xdgConfigHome: string) => {
  return resolve(xdgConfigHome, CONSTANTS.XDG.APP_DIRECTORY_NAME);
};

export const resolveDotweaveGlobalConfigFilePath = (
  dotweaveConfigDirectory: string,
) => {
  return resolve(dotweaveConfigDirectory, CONSTANTS.GLOBAL_CONFIG.FILE_NAME);
};

export const resolveDotweaveSyncDirectory = (
  dotweaveConfigDirectory: string,
) => {
  return resolve(dotweaveConfigDirectory, CONSTANTS.XDG.SYNC_DIRECTORY_NAME);
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

  if (expandedValue === xdgConfigHomeToken) {
    expandedValue = resolvedXdgConfigHome;
  } else if (expandedValue.startsWith(xdgConfigHomeTokenPrefix)) {
    expandedValue = resolve(
      resolvedXdgConfigHome,
      expandedValue.slice(xdgConfigHomeTokenPrefix.length),
    );
  } else if (expandedValue === bracedXdgConfigHomeToken) {
    expandedValue = resolvedXdgConfigHome;
  } else if (expandedValue.startsWith(bracedXdgConfigHomePrefix)) {
    expandedValue = resolve(
      resolvedXdgConfigHome,
      expandedValue.slice(bracedXdgConfigHomePrefix.length),
    );
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
      `Configured path must be absolute or start with ~ or ${xdgConfigHomeToken}: ${value}`,
    );
  }

  return resolve(expandedValue);
};

export const expandWindowsEnvVars = (
  value: string,
  readEnv: (name: string) => string | undefined,
): string => {
  return value.replace(/%([^%]+)%/g, (_match, varName: string) => {
    const envValue = readTrimmedEnvironmentValue(readEnv, varName);

    if (envValue === undefined) {
      throw new Error(`Environment variable %${varName}% is not defined.`);
    }

    return envValue;
  });
};
