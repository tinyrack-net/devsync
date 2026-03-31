import { platform, release } from "node:os";

import { ENV, type Env } from "#app/lib/env.ts";

export type PlatformKey = "win" | "mac" | "linux" | "wsl";

export type PlatformLocalPath = Readonly<{
  default: string;
  win?: string;
  mac?: string;
  linux?: string;
  wsl?: string;
}>;

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

export const resolveLocalPathForPlatform = (
  localPath: PlatformLocalPath,
  platformKey?: PlatformKey,
  environment: Env = ENV,
): string => {
  const key = platformKey ?? detectCurrentPlatformKey(environment);

  if (key === "wsl") {
    return localPath.wsl ?? localPath.linux ?? localPath.default;
  }

  return localPath[key] ?? localPath.default;
};
