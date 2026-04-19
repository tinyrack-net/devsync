import { platform, release } from "node:os";

import { detectCurrentPlatformKey } from "#app/config/platform.ts";
import {
  resolveDotweaveConfigDirectory,
  resolveDotweaveGlobalConfigFilePath,
  resolveDotweaveSyncDirectory,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";
import { ENV } from "#app/lib/env.ts";

const trimConfiguredValue = (value: string | undefined) => {
  const trimmedValue = value?.trim();

  return trimmedValue === undefined || trimmedValue === ""
    ? undefined
    : trimmedValue;
};

export const readEnvValue = (name: string) => {
  return trimConfiguredValue(ENV[name]);
};

export const resolveHomeDirectoryFromEnv = () => {
  return resolveHomeDirectory(readEnvValue("HOME"));
};

export const resolveXdgConfigHomeFromEnv = () => {
  return resolveXdgConfigHome(
    readEnvValue("HOME"),
    readEnvValue("XDG_CONFIG_HOME"),
  );
};

export const resolveDotweaveGlobalConfigFilePathFromEnv = () => {
  const configDirectory = resolveDotweaveConfigDirectory(
    resolveXdgConfigHomeFromEnv(),
  );
  return resolveDotweaveGlobalConfigFilePath(configDirectory);
};

export const resolveDotweaveSyncDirectoryFromEnv = () => {
  const configDirectory = resolveDotweaveConfigDirectory(
    resolveXdgConfigHomeFromEnv(),
  );
  return resolveDotweaveSyncDirectory(configDirectory);
};

export const resolveCurrentPlatformKey = () => {
  return detectCurrentPlatformKey(
    platform(),
    release(),
    readEnvValue("WSL_DISTRO_NAME"),
    readEnvValue("WSL_INTEROP"),
  );
};
