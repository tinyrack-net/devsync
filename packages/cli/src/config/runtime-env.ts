import { homedir, platform, release } from "node:os";

import { detectCurrentPlatformKey } from "#app/config/platform.ts";
import {
  resolveDotweaveGlobalConfigFilePath,
  resolveDotweaveHomeDirectory,
  resolveDotweaveSyncDirectory,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";
import { ENV } from "#app/lib/env.ts";
import { normalizeConfiguredValue } from "#app/lib/string.ts";

export const readEnvValue = (name: string) => {
  return normalizeConfiguredValue(ENV[name]);
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

export const resolveDotweaveHomeDirectoryFromEnv = () => {
  return resolveDotweaveHomeDirectory({
    appData: readEnvValue("APPDATA"),
    dotweaveHome: readEnvValue("DOTWEAVE_HOME"),
    home: readEnvValue("HOME"),
    localAppData: readEnvValue("LOCALAPPDATA"),
    osHomeDirectory: homedir(),
    platform: platform(),
    userProfile: readEnvValue("USERPROFILE"),
    xdgConfigHome: readEnvValue("XDG_CONFIG_HOME"),
  });
};

export const resolveDotweaveGlobalConfigFilePathFromEnv = () => {
  return resolveDotweaveGlobalConfigFilePath(
    resolveDotweaveHomeDirectoryFromEnv(),
  );
};

export const resolveDotweaveSyncDirectoryFromEnv = () => {
  return resolveDotweaveSyncDirectory(resolveDotweaveHomeDirectoryFromEnv());
};

export const resolveCurrentPlatformKey = () => {
  return detectCurrentPlatformKey(
    platform(),
    release(),
    readEnvValue("WSL_DISTRO_NAME"),
    readEnvValue("WSL_INTEROP"),
  );
};
