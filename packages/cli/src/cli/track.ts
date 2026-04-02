import { buildCommand } from "@stricli/core";
import pc from "picocolors";
import { CONSTANTS } from "#app/config/constants.ts";
import { DevsyncError } from "#app/lib/error.ts";
import { assignProfiles } from "#app/services/profile.ts";
import { setTargetMode } from "#app/services/set.ts";
import {
  type DevsyncCliContext,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { createCliLogger } from "#app/services/terminal/logger.ts";
import { proposePathCompletions } from "#app/services/terminal/path-completion.ts";
import { trackTarget } from "#app/services/track.ts";

type TrackFlags = {
  mode: "ignore" | "normal" | "secret";
  profile?: readonly string[];
  repoPath?: string;
  verbose?: boolean;
};

const trackCommand = buildCommand<TrackFlags, string[], DevsyncCliContext>({
  docs: {
    brief: "Track local files or directories for syncing",
    fullDescription:
      "Register one or more files or directories inside your home directory so devsync can mirror them into the sync directory. If a target is already tracked, its mode is updated. Targets may also be repository paths inside a tracked directory to create child entries with a specific mode.",
  },
  async func(flags, ...targets) {
    const verbose = flags.verbose ?? false;
    const logger = createCliLogger({ verbose });
    const profiles = [...(flags.profile ?? [])];
    const cwd = process.cwd();

    if (flags.repoPath !== undefined && targets.length !== 1) {
      throw new DevsyncError(
        "The --repo-path flag can only be used with a single sync target.",
        {
          code: "REPO_PATH_TARGET_COUNT",
          hint: "Track one target at a time when overriding its repository path.",
        },
      );
    }

    if (verbose) {
      logger.start(
        `Processing ${targets.length} sync target${targets.length === 1 ? "" : "s"}...`,
      );
    }

    for (const target of targets) {
      if (verbose) {
        logger.start(`Resolving ${target}...`);
      }

      try {
        const result = await trackTarget(
          {
            mode: flags.mode,
            profiles: profiles.length > 0 ? profiles : undefined,
            ...(flags.repoPath === undefined
              ? {}
              : { repoPath: flags.repoPath }),
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

        const profileInfo =
          result.profiles.length > 0
            ? ` · profiles: ${result.profiles.join(", ")}`
            : "";
        logger.log(
          `  ${result.localPath} · mode: ${result.mode}${profileInfo}`,
        );

        if (verbose) {
          logger.log(pc.dim(`  kind: ${result.kind}`));
          logger.log(pc.dim(`  sync dir  ${result.syncDirectory}`));
          logger.log(pc.dim(`  config    ${result.configPath}`));
        }
      } catch (error: unknown) {
        if (
          flags.repoPath === undefined &&
          error instanceof DevsyncError &&
          error.code === "TARGET_NOT_FOUND"
        ) {
          if (verbose) {
            logger.start(`Updating existing target ${target}...`);
          }

          const setResult = await setTargetMode(
            { mode: flags.mode, target },
            cwd,
          );

          if (profiles.length > 0) {
            const isProfileClear = profiles.length === 1 && profiles[0] === "";
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

          logger.log(`  mode: ${setResult.mode}`);

          if (setResult.reason === "already-set") {
            logger.log(pc.dim(`  already ${setResult.mode}`));
          }

          if (verbose) {
            logger.log(pc.dim(`  local     ${setResult.localPath}`));
            logger.log(pc.dim(`  sync dir  ${setResult.syncDirectory}`));
            logger.log(pc.dim(`  config    ${setResult.configPath}`));
          }

          continue;
        }

        throw error;
      }
    }
  },
  parameters: {
    flags: {
      mode: {
        brief: "Sync mode for the tracked targets",
        default: CONSTANTS.SYNC.MODES[0],
        kind: "enum",
        values: CONSTANTS.SYNC.MODES,
      },
      profile: {
        brief: "Restrict syncing to specific profiles",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "profile",
        variadic: true,
      },
      repoPath: {
        brief: "Repository-relative path under the profile namespace",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "path",
      },
      verbose: verboseFlag,
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
