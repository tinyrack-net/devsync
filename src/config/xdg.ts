import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const readTrimmedEnvironmentValue = (
  environment: NodeJS.ProcessEnv,
  key: string,
) => {
  const value = environment[key];

  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === "" ? undefined : trimmedValue;
};

const bracedXdgConfigHomeToken = "$" + "{XDG_CONFIG_HOME}";
const bracedXdgConfigHomePrefix = `${bracedXdgConfigHomeToken}/`;

export const resolveHomeDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const configuredValue = readTrimmedEnvironmentValue(environment, "HOME");

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(homedir());
};

export const resolveXdgConfigHome = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const configuredValue = readTrimmedEnvironmentValue(
    environment,
    "XDG_CONFIG_HOME",
  );

  if (configuredValue !== undefined) {
    return resolve(configuredValue);
  }

  return resolve(resolveHomeDirectory(environment), ".config");
};

export const resolveDevsyncConfigDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolve(resolveXdgConfigHome(environment), "devsync");
};

export const resolveDevsyncGlobalConfigFilePath = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolve(resolveDevsyncConfigDirectory(environment), "settings.json");
};

export const resolveDevsyncSyncDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolve(resolveDevsyncConfigDirectory(environment), "sync");
};

export const resolveDevsyncAgeDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolve(resolveDevsyncConfigDirectory(environment), "age");
};

export const expandHomePath = (
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
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

export const expandConfiguredPath = (
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  let expandedValue = expandHomePath(value, environment);

  if (expandedValue === "$XDG_CONFIG_HOME") {
    expandedValue = resolveXdgConfigHome(environment);
  } else if (expandedValue.startsWith("$XDG_CONFIG_HOME/")) {
    expandedValue = resolve(
      resolveXdgConfigHome(environment),
      expandedValue.slice("$XDG_CONFIG_HOME/".length),
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
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const expandedValue = expandConfiguredPath(value, environment);

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~ or $XDG_CONFIG_HOME: ${value}`,
    );
  }

  return resolve(expandedValue);
};

export const expandWindowsEnvVars = (
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
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
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  let expanded = value.trim();

  if (expanded.includes("%")) {
    expanded = expandWindowsEnvVars(expanded, environment);
  }

  return expandConfiguredPath(expanded, environment);
};

export const resolvePlatformConfiguredAbsolutePath = (
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const expandedValue = expandPlatformConfiguredPath(value, environment);

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~, $XDG_CONFIG_HOME, or %ENV_VAR%: ${value}`,
    );
  }

  return resolve(expandedValue);
};

export const resolveHomeConfiguredAbsolutePath = (
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const expandedValue = expandHomePath(value, environment);

  if (!isAbsolute(expandedValue)) {
    throw new Error(
      `Configured path must be absolute or start with ~: ${value}`,
    );
  }

  return resolve(expandedValue);
};
