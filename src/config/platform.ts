import { platform } from "node:os";

export type PlatformKey = "win" | "mac" | "linux";

export type ConfiguredLocalPath = Readonly<{
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
  localPath: ConfiguredLocalPath,
  platformKey?: PlatformKey,
): string => {
  const key = platformKey ?? detectCurrentPlatformKey();

  return localPath[key] ?? localPath.default;
};

export const getDefaultLocalPath = (localPath: ConfiguredLocalPath): string => {
  return localPath.default;
};
