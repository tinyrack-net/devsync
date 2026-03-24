import { platform } from "node:os";

export type PlatformKey = "win" | "mac" | "linux";

export type PlatformLocalPath = Readonly<{
  default: string;
  win?: string;
  mac?: string;
  linux?: string;
}>;

export const detectCurrentPlatformKey = (): PlatformKey => {
  switch (platform()) {
    case "win32":
      return "win";
    case "darwin":
      return "mac";
    default:
      return "linux";
  }
};

export const resolveLocalPathForPlatform = (
  localPath: PlatformLocalPath,
  platformKey?: PlatformKey,
): string => {
  const key = platformKey ?? detectCurrentPlatformKey();

  return localPath[key] ?? localPath.default;
};

export const resolveDefaultLocalPath = (
  localPath: PlatformLocalPath,
): string => {
  return localPath.default;
};
