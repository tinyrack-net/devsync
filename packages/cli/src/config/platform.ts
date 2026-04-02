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

export const isWslEnvironment = (
  osRelease: string,
  wslDistroName: string | undefined,
  wslInterop: string | undefined,
): boolean => {
  return (
    Boolean(wslDistroName?.trim() || wslInterop?.trim()) ||
    osRelease.toLowerCase().includes("microsoft")
  );
};

export const detectCurrentPlatformKey = (
  platformName: NodeJS.Platform,
  osRelease: string,
  wslDistroName: string | undefined,
  wslInterop: string | undefined,
): PlatformKey => {
  switch (platformName) {
    case "win32":
      return "win";
    case "darwin":
      return "mac";
    case "linux":
      return isWslEnvironment(osRelease, wslDistroName, wslInterop)
        ? "wsl"
        : "linux";
    default:
      return "linux";
  }
};

const resolveStringValueForPlatform = (
  value: PlatformStringValue,
  platformKey: PlatformKey,
): string => {
  if (platformKey === "wsl") {
    return value.wsl ?? value.linux ?? value.default;
  }

  return value[platformKey] ?? value.default;
};

export const resolveLocalPathForPlatform = (
  localPath: PlatformLocalPath,
  platformKey: PlatformKey,
): string => {
  return resolveStringValueForPlatform(localPath, platformKey);
};

export const resolveRepoPathForPlatform = (
  repoPath: PlatformRepoPath,
  platformKey: PlatformKey,
): string => {
  return resolveStringValueForPlatform(repoPath, platformKey);
};
