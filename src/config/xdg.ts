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

  return resolve(homedir(), ".config");
};

export const resolveDevtoolsConfigDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolve(resolveXdgConfigHome(environment), "devtools");
};

export const resolveDevtoolsSyncDirectory = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolve(resolveDevtoolsConfigDirectory(environment), "sync");
};

export const expandConfiguredPath = (
  value: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  let expandedValue = value.trim();

  if (expandedValue === "~") {
    expandedValue = homedir();
  } else if (expandedValue.startsWith("~/")) {
    expandedValue = resolve(homedir(), expandedValue.slice(2));
  }

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
