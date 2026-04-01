import { platform, release } from "node:os";

import { ENV, type Env } from "#app/lib/env.ts";

export type PlatformKey = "win" | "mac" | "linux" | "wsl";

type PlatformStringValue = Readonly<{
  default: string;
  win?: string;
  mac?: string;
  linux?: string;
  wsl?: string;
}>;

export type PlatformLocalPath = PlatformStringValue;
export type PlatformRepoPath = PlatformStringValue;

const isWslEnvironment = (environment: Env = ENV): boolean => {
  const wslDistroName = environment.WSL_DISTRO_NAME;
  const wslInterop = environment.WSL_INTEROP;

  return (
    Boolean(wslDistroName?.trim() || wslInterop?.trim()) ||
    release().toLowerCase().includes("microsoft")
  );
};

export const detectCurrentPlatformKey = (
  environment: Env = ENV,
): PlatformKey => {
  switch (platform()) {
    case "win32":
      return "win";
    case "darwin":
      return "mac";
    case "linux":
      return isWslEnvironment(environment) ? "wsl" : "linux";
    default:
      return "linux";
  }
};

const resolveStringValueForPlatform = (
  value: PlatformStringValue,
  platformKey?: PlatformKey,
  environment: Env = ENV,
): string => {
  const key = platformKey ?? detectCurrentPlatformKey(environment);

  if (key === "wsl") {
    return value.wsl ?? value.linux ?? value.default;
  }

  return value[key] ?? value.default;
};

export const resolveLocalPathForPlatform = (
  localPath: PlatformLocalPath,
  platformKey?: PlatformKey,
  environment: Env = ENV,
): string => {
  return resolveStringValueForPlatform(localPath, platformKey, environment);
};

export const resolveRepoPathForPlatform = (
  repoPath: PlatformRepoPath,
  platformKey?: PlatformKey,
  environment: Env = ENV,
): string => {
  return resolveStringValueForPlatform(repoPath, platformKey, environment);
};
