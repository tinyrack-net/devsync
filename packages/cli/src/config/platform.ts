export type PlatformKey = "win" | "mac" | "linux" | "wsl";

export type PlatformStringValue = Readonly<{
  default: string;
  win?: string;
  mac?: string;
  linux?: string;
  wsl?: string;
}>;

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

export const resolvePlatformValue = (
  value: PlatformStringValue,
  platformKey: PlatformKey,
): string => {
  if (platformKey === "wsl") {
    return value.wsl ?? value.linux ?? value.default;
  }

  return value[platformKey] ?? value.default;
};
