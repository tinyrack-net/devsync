import { buildCommand } from "@stricli/core";

import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/cli/common.js";
import { proposePathCompletions } from "#app/cli/path-completion.js";
import { formatSyncAddResult, formatSyncSetResult } from "#app/lib/output.js";
import { trackSyncTarget } from "#app/services/add.js";
import { DevsyncError } from "#app/services/error.js";
import { assignSyncProfiles } from "#app/services/profile.js";
import { setSyncTargetMode } from "#app/services/set.js";

type TrackFlags = {
  mode: "ignore" | "normal" | "secret";
  profile?: readonly string[];
  verbose?: boolean;
};

const trackCommand = buildCommand<TrackFlags, string[], DevsyncCliContext>({
  docs: {
    brief: "Track local files or directories for syncing",
    fullDescription:
      "Register one or more files or directories inside your home directory so devsync can mirror them into the sync repository. If a target is already tracked, its mode is updated. Targets may also be repository paths inside a tracked directory to create child entries with a specific mode.",
  },
  async func(flags, ...targets) {
    const verbose = isVerbose(flags.verbose);
    const profiles = [...(flags.profile ?? [])];
    const progress = createProgressReporter(verbose);
    const environment = process.env;
    const cwd = process.cwd();

    progress.phase(
      `Processing ${targets.length} sync target${targets.length === 1 ? "" : "s"}...`,
    );

    for (const target of targets) {
      progress.phase(`Resolving ${target}...`);

      try {
        const result = await trackSyncTarget(
          {
            mode: flags.mode,
            profiles: profiles.length > 0 ? profiles : undefined,
            target,
          },
          environment,
          cwd,
        );

        print(formatSyncAddResult(result, { verbose }));
      } catch (error: unknown) {
        if (
          error instanceof DevsyncError &&
          error.code === "TARGET_NOT_FOUND"
        ) {
          progress.phase(`Updating existing target ${target}...`);
          const setResult = await setSyncTargetMode(
            {
              mode: flags.mode,
              target,
            },
            environment,
            cwd,
          );

          if (profiles.length > 0) {
            const isProfileClear = profiles.length === 1 && profiles[0] === "";
            await assignSyncProfiles(
              { profiles: isProfileClear ? [] : profiles, target },
              environment,
              cwd,
            );
          }

          print(formatSyncSetResult(setResult, { verbose }));
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
        default: "normal",
        kind: "enum",
        values: ["normal", "secret", "ignore"],
      },
      profile: {
        brief: "Restrict syncing to specific profiles",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "profile",
        variadic: true,
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
