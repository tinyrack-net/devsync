import { AppConstants } from "#app/config/constants.ts";
import type { ConfigMigrationFn } from "#app/config/migration.ts";
import { DotweaveError } from "#app/lib/error.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeLegacyProfileName = (value: string) => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new DotweaveError("Profile name must not be empty.", {
      code: "INVALID_PROFILE_NAME",
      details: [`Profile name: ${value}`],
      hint: "Use a short profile name like 'work' or 'personal'.",
    });
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(normalizedValue)) {
    throw new DotweaveError("Profile name contains unsupported characters.", {
      code: "INVALID_PROFILE_NAME",
      details: [`Profile name: ${value}`],
      hint: "Use letters, numbers, dots, underscores, or hyphens, and start with a letter or number.",
    });
  }

  if (normalizedValue.startsWith(".")) {
    throw new DotweaveError("Profile name must not start with '.'.", {
      code: "INVALID_PROFILE_NAME",
      details: [`Profile name: ${value}`],
      hint: "Use a plain name like 'work' instead of hidden-path style names.",
    });
  }

  if (normalizedValue === "." || normalizedValue === "..") {
    throw new DotweaveError("Profile name is invalid.", {
      code: "INVALID_PROFILE_NAME",
      details: [`Profile name: ${value}`],
    });
  }

  return normalizedValue;
};

export const migrateSyncConfigV7ToV8: ConfigMigrationFn = (config) => {
  const profiles = new Set<string>();
  const typedConfig = config as { entries?: unknown };
  const entries = Array.isArray(typedConfig.entries) ? typedConfig.entries : [];

  for (const entry of entries) {
    const typedEntry = entry as { profiles?: unknown };

    if (!isRecord(entry) || !Array.isArray(typedEntry.profiles)) {
      continue;
    }

    for (const profile of typedEntry.profiles) {
      if (typeof profile !== "string") {
        throw new DotweaveError("Profile name must be a string.", {
          code: "INVALID_PROFILE_NAME",
          details: [`Profile value: ${String(profile)}`],
          hint: "Use a short profile name like 'work' or 'personal'.",
        });
      }

      const normalizedProfile = normalizeLegacyProfileName(profile);

      if (normalizedProfile !== AppConstants.SYNC.DEFAULT_PROFILE) {
        profiles.add(normalizedProfile);
      }
    }
  }

  return {
    ...config,
    version: 8,
    profiles: [...profiles].sort((left, right) => left.localeCompare(right)),
  };
};
