import type { ApplicationContext } from "@stricli/core";
import { buildCommand } from "@stricli/core";
import { AppConstants } from "#app/config/constants.ts";
import { DotweaveError } from "#app/lib/error.ts";
import {
  assignProfiles,
  validateProfilesExist,
} from "#app/services/profile.ts";
import { setTargetMode } from "#app/services/sync-mode.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { proposePathCompletions } from "#app/services/terminal/path-completion.ts";
import { trackTarget } from "#app/services/track.ts";
import {
  parsePlatformModeFlags,
  parsePlatformPermissionFlags,
  parsePlatformStringFlags,
  parsePlatformStringOverrideFlags,
} from "./platform-flags.ts";

type TrackFlags = {
  kind?: "directory" | "file";
  local?: readonly string[];
  mode?: readonly string[];
  permission?: readonly string[];
  profile?: readonly string[];
  repo?: readonly string[];
};

const normalizeFlagValues = (
  values: readonly string[] | string | undefined,
): readonly string[] | undefined => {
  if (values === undefined) {
    return undefined;
  }

  return typeof values === "string" ? [values] : values;
};

const trackCommand = buildCommand<TrackFlags, string[], ApplicationContext>({
  docs: {
    brief: "Track local files or directories for syncing",
    fullDescription:
      "Register a file or directory inside your home directory so dotweave can mirror it into the sync directory. If a target is already tracked, specified manifest fields are updated and unspecified fields are preserved.",
  },
  async func(flags, ...targets) {
    const logger = createCliLogger();
    const profiles = [...(flags.profile ?? [])];
    const cwd = process.cwd();

    if (flags.repo !== undefined && targets.length !== 1) {
      throw new DotweaveError(
        "The --repo flag can only be used with a single sync target.",
        {
          code: "REPO_PATH_TARGET_COUNT",
          hint: "Track one target at a time when overriding its repository path.",
        },
      );
    }

    const mode = parsePlatformModeFlags(
      "mode",
      normalizeFlagValues(flags.mode),
    );
    const fallbackMode = mode?.default ?? AppConstants.SYNC.MODES[0];
    const repoPath = parsePlatformStringFlags(
      "repo",
      normalizeFlagValues(flags.repo),
    );
    const localPathOverrides = parsePlatformStringOverrideFlags(
      "local",
      normalizeFlagValues(flags.local),
    );
    const permission = parsePlatformPermissionFlags(
      "permission",
      normalizeFlagValues(flags.permission),
    );

    for (const target of targets) {
      try {
        const result = await trackTarget(
          {
            ...(flags.kind === undefined ? {} : { kind: flags.kind }),
            ...(localPathOverrides === undefined ? {} : { localPathOverrides }),
            ...(mode === undefined ? {} : { mode }),
            ...(permission === undefined ? {} : { permission }),
            profiles: profiles.length > 0 ? profiles : undefined,
            ...(repoPath === undefined ? {} : { repoPath }),
            target,
          },
          cwd,
        );

        if (!result.alreadyTracked) {
          logger.success(`Started tracking ${result.repoPath}`);
        } else if (result.changed) {
          logger.success(`Updated tracking for ${result.repoPath}`);
        } else {
          logger.info(`${result.repoPath} already tracked`);
        }

        const details: { key: string; value?: string }[] = [
          { key: "kind", value: result.kind },
          { key: "path", value: result.localPath },
          { key: "repo", value: result.repoPath },
          { key: "mode", value: result.mode },
        ];
        if (result.configuredPermission !== undefined) {
          details.push({
            key: "permission",
            value: result.configuredPermission.default,
          });
        }
        if (result.profiles.length > 0) {
          details.push({ key: "profiles", value: result.profiles.join(", ") });
        }
        logger.listKeyValue(details);
      } catch (error: unknown) {
        if (
          repoPath === undefined &&
          error instanceof DotweaveError &&
          error.code === "TARGET_NOT_FOUND"
        ) {
          const isProfileClear = profiles.length === 1 && profiles[0] === "";

          if (profiles.length > 0 && !isProfileClear) {
            await validateProfilesExist(profiles);
          }

          const setResult = await setTargetMode(
            { mode: fallbackMode, target },
            cwd,
          );

          if (profiles.length > 0) {
            await assignProfiles(
              { profiles: isProfileClear ? [] : profiles, target },
              cwd,
            );
          }

          if (setResult.action === "unchanged") {
            logger.info(`Sync mode unchanged for ${setResult.repoPath}`);
          } else {
            logger.success(`Updated sync mode for ${setResult.repoPath}`);
          }

          logger.listKeyValue([{ key: "mode", value: setResult.mode }]);

          if (setResult.reason === "already-set") {
            logger.log(`  already ${setResult.mode}`);
          }

          continue;
        }

        throw error;
      }
    }
  },
  parameters: {
    flags: {
      kind: {
        brief: "Target kind to use when the path does not exist yet",
        kind: "enum",
        optional: true,
        values: ["file", "directory"],
      },
      mode: {
        brief: "Sync mode for the tracked targets",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "mode|platform=mode",
        variadic: true,
      },
      permission: {
        brief: "File permission to restore, as a 4-character octal value",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "octal|platform=octal",
        variadic: true,
      },
      profile: {
        brief:
          "Restrict syncing to registered profiles (add non-default profiles with 'dotweave profile add')",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "profile",
        variadic: true,
      },
      local: {
        brief: "Platform-specific local path override",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "platform=path",
        variadic: true,
      },
      repo: {
        brief: "Repository-relative path under the profile namespace",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "path|platform=path",
        variadic: true,
      },
    },
    positional: {
      kind: "array",
      minimum: 1,
      parameter: {
        brief:
          "Local files or directories under your home directory to track, including cwd-relative paths or repository paths inside tracked directories",
        parse: String,
        placeholder: "target",
        proposeCompletions: proposePathCompletions,
      },
    },
  },
});

export default trackCommand;
