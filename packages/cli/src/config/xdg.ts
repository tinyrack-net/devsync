import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { CONSTANTS } from "#app/config/constants.ts";
import { ENV, type Env } from "#app/lib/env.ts";

const xdgConfigHomeToken = "$XDG_CONFIG_HOME";
const xdgConfigHomeTokenPrefix = `${xdgConfigHomeToken}/`;
const bracedXdgConfigHomeToken = "${XDG_CONFIG_HOME}";
const bracedXdgConfigHomePrefix = `${bracedXdgConfigHomeToken}/`;

const readTrimmedEnvironmentValue = (environment: Env, key: string) => {
  const value = environment[key];

  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === "" ? undefined : trimmedValue;
};

export const resolveHomeDirectory = (environment: Env = ENV) => {
  const configuredValue = readTrimmedEnvironmentValue(environment, "HOME");

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(homedir());
};

export const resolveXdgConfigHome = (environment: Env = ENV) => {
  const configuredValue = readTrimmedEnvironmentValue(
    environment,
    "XDG_CONFIG_HOME",
  );

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(resolveHomeDirectory(environment), ".config");
};

export const resolveDevsyncConfigDirectory = (environment: Env = ENV) => {
  return resolve(
    resolveXdgConfigHome(environment),
    CONSTANTS.XDG.APP_DIRECTORY_NAME,
  );
};

export const resolveDevsyncGlobalConfigFilePath = (environment: Env = ENV) => {
  return resolve(
    resolveDevsyncConfigDirectory(environment),
    CONSTANTS.GLOBAL_CONFIG.FILE_NAME,
  );
};

export const resolveDevsyncSyncDirectory = (environment: Env = ENV) => {
  return resolve(
    resolveDevsyncConfigDirectory(environment),
    CONSTANTS.XDG.SYNC_DIRECTORY_NAME,
  );
};

export const resolveDevsyncAgeDirectory = (environment: Env = ENV) => {
  return resolve(
    resolveDevsyncConfigDirectory(environment),
    CONSTANTS.XDG.AGE_DIRECTORY_NAME,
  );
};

export const expandHomePath = (value: string, environment: Env = ENV) => {
  let expandedValue = value.trim();

  if (expandedValue === "~") {
    expandedValue = resolveHomeDirectory(environment);
  } else if (expandedValue.startsWith("~/")) {
    expandedValue = resolve(
      resolveHomeDirectory(environment),
      expandedValue.slice(2),
    );
  }

  return expandedValue;
};

export const expandConfiguredPath = (value: string, environment: Env = ENV) => {
  let expandedValue = expandHomePath(value, environment);

  if (expandedValue === xdgConfigHomeToken) {
    expandedValue = resolveXdgConfigHome(environment);
  } else if (expandedValue.startsWith(xdgConfigHomeTokenPrefix)) {
    expandedValue = resolve(
      resolveXdgConfigHome(environment),
      expandedValue.slice(xdgConfigHomeTokenPrefix.length),
    );
  } else if (expandedValue === bracedXdgConfigHomeToken) {
    expandedValue = resolveXdgConfigHome(environment);
  } else if (expandedValue.startsWith(bracedXdgConfigHomePrefix)) {
    expandedValue = resolve(
      resolveXdgConfigHome(environment),
      expandedValue.slice(bracedXdgConfigHomePrefix.length),
    );
  }

  return expandedValue;
};

export const resolveConfiguredAbsolutePath = (
  value: string,
  environment: Env = ENV,
) => {
  const expandedValue = expandConfiguredPath(value, environment);

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~ or ${xdgConfigHomeToken}: ${value}`,
    );
  }

  return resolve(expandedValue);
};

export const expandWindowsEnvVars = (
  value: string,
  environment: Env = ENV,
): string => {
  return value.replace(/%([^%]+)%/g, (_match, varName: string) => {
    const envValue = readTrimmedEnvironmentValue(environment, varName);

    if (envValue === undefined) {
      throw new Error(`Environment variable %${varName}% is not defined.`);
    }

    return envValue;
  });
};

export const expandPlatformConfiguredPath = (
  value: string,
  environment: Env = ENV,
): string => {
  let expanded = value.trim();

  if (expanded.includes("%")) {
    expanded = expandWindowsEnvVars(expanded, environment);
  }

  return expandConfiguredPath(expanded, environment);
};

export const resolvePlatformConfiguredAbsolutePath = (
  value: string,
  environment: Env = ENV,
) => {
  const expandedValue = expandPlatformConfiguredPath(value, environment);

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~, ${xdgConfigHomeToken}, or %ENV_VAR%: ${value}`,
    );
  }

  return resolve(expandedValue);
};

export const resolveHomeConfiguredAbsolutePath = (
  value: string,
  environment: Env = ENV,
) => {
  const expandedValue = expandHomePath(value, environment);

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~: ${value}`,
    );
  }

  return resolve(expandedValue);
};
