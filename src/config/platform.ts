import { platform, release } from "node:os";

export type PlatformKey = "win" | "mac" | "linux" | "wsl";

export type PlatformLocalPath = Readonly<{
  default: string;
  win?: string;
  mac?: string;
  linux?: string;
  wsl?: string;
}>;

const isWslEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): boolean => {
  const wslEnvironment = environment as NodeJS.ProcessEnv & {
    WSL_DISTRO_NAME?: string;
    WSL_INTEROP?: string;
  };
  const wslDistroName = wslEnvironment.WSL_DISTRO_NAME;
  const wslInterop = wslEnvironment.WSL_INTEROP;

  return (
    Boolean(wslDistroName?.trim() || wslInterop?.trim()) ||
    release().toLowerCase().includes("microsoft")
  );
};

export const detectCurrentPlatformKey = (
  environment: NodeJS.ProcessEnv = process.env,
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
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const key = platformKey ?? detectCurrentPlatformKey(environment);

  if (key === "wsl") {
    return localPath.wsl ?? localPath.linux ?? localPath.default;
  }

  return localPath[key] ?? localPath.default;
};

export const resolveDefaultLocalPath = (
  localPath: PlatformLocalPath,
): string => {
  return localPath.default;
};
