import { AppConstants } from "#app/config/constants.ts";
import type { PlatformStringValue } from "#app/config/platform.ts";
import type {
  PlatformPermission,
  PlatformSyncMode,
  SyncMode,
} from "#app/config/sync-schema.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { isPermissionOctal } from "#app/lib/file-mode.ts";

export type PlatformFlagKey = "default" | "win" | "mac" | "linux" | "wsl";

type ParsedPlatformFlags = Partial<Record<PlatformFlagKey, string>>;

const platformFlagKeys = new Set<PlatformFlagKey>([
  "default",
  "win",
  "mac",
  "linux",
  "wsl",
]);

const syncModes = new Set<SyncMode>(AppConstants.SYNC.MODES);

const parsePlatformFlagValues = (
  flagName: string,
  values: readonly string[] | undefined,
  options: Readonly<{ allowDefault: boolean }>,
) => {
  if (values === undefined || values.length === 0) {
    return undefined;
  }

  const parsed: ParsedPlatformFlags = {};

  for (const rawValue of values) {
    const separatorIndex = rawValue.indexOf("=");
    const key =
      separatorIndex === -1 ? "default" : rawValue.slice(0, separatorIndex);
    const value =
      separatorIndex === -1 ? rawValue : rawValue.slice(separatorIndex + 1);

    if (
      key.length === 0 ||
      value.length === 0 ||
      !platformFlagKeys.has(key as PlatformFlagKey) ||
      (!options.allowDefault && key === "default")
    ) {
      throw new DotweaveError(`Invalid --${flagName} platform value.`, {
        code: "INVALID_PLATFORM_FLAG",
        hint: options.allowDefault
          ? `Use --${flagName} value or --${flagName} platform=value.`
          : `Use --${flagName} platform=value with win, mac, linux, or wsl.`,
      });
    }

    const platformKey = key as PlatformFlagKey;

    if (parsed[platformKey] !== undefined) {
      throw new DotweaveError(`Duplicate --${flagName} platform value.`, {
        code: "DUPLICATE_PLATFORM_FLAG",
        details: [`Platform '${platformKey}' was specified more than once.`],
      });
    }

    parsed[platformKey] = value;
  }

  return parsed;
};

const mapPlatformValues = <T extends string>(
  parsed: ParsedPlatformFlags | undefined,
  validate: (value: string) => T,
) => {
  if (parsed === undefined) {
    return undefined;
  }

  const mapped: Partial<Record<PlatformFlagKey, T>> = {};

  for (const [key, value] of Object.entries(parsed)) {
    mapped[key as PlatformFlagKey] = validate(value);
  }

  return mapped;
};

export const parsePlatformStringFlags = (
  flagName: string,
  values: readonly string[] | undefined,
): PlatformStringValue | undefined => {
  return parsePlatformFlagValues(flagName, values, {
    allowDefault: true,
  }) as PlatformStringValue | undefined;
};

export const parsePlatformStringOverrideFlags = (
  flagName: string,
  values: readonly string[] | undefined,
): Partial<PlatformStringValue> | undefined => {
  return parsePlatformFlagValues(flagName, values, {
    allowDefault: false,
  });
};

export const parsePlatformModeFlags = (
  flagName: string,
  values: readonly string[] | undefined,
): PlatformSyncMode | undefined => {
  return mapPlatformValues(
    parsePlatformFlagValues(flagName, values, { allowDefault: true }),
    (value) => {
      if (!syncModes.has(value as SyncMode)) {
        throw new DotweaveError(`Invalid --${flagName} mode '${value}'.`, {
          code: "INVALID_SYNC_MODE",
          hint: `Use one of: ${AppConstants.SYNC.MODES.join(", ")}.`,
        });
      }

      return value as SyncMode;
    },
  ) as PlatformSyncMode | undefined;
};

export const parsePlatformPermissionFlags = (
  flagName: string,
  values: readonly string[] | undefined,
): PlatformPermission | undefined => {
  return mapPlatformValues(
    parsePlatformFlagValues(flagName, values, { allowDefault: true }),
    (value) => {
      if (!isPermissionOctal(value)) {
        throw new DotweaveError(
          `Invalid --${flagName} permission '${value}'.`,
          {
            code: "INVALID_PERMISSION",
            hint: "Use a 4-character octal permission like '0600' or '0755'.",
          },
        );
      }

      return value;
    },
  ) as PlatformPermission | undefined;
};
