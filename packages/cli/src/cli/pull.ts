import { buildCommand } from "@stricli/core";
import { type PullResult, pullChanges } from "#app/services/pull.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";

const formatPullOutput = (result: PullResult, verbose = false) => {
  return output(
    result.dryRun ? "Dry run: pull preview" : "Pull complete",
    `changes: ${result.plainFileCount} plain, ${result.decryptedFileCount} decrypted, ${result.symlinkCount} symlinks, ${result.directoryCount} dirs`,
    `${result.dryRun ? "cleanup preview" : "cleanup"}: ${result.deletedLocalCount} ${result.dryRun ? "local paths would be removed" : "local paths removed"}`,
    verbose && `sync dir: ${result.syncDirectory}`,
    verbose && `config: ${result.configPath}`,
  );
};

type PullFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
};

const pullCommand = buildCommand<PullFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Apply the git-backed sync repository to local config paths",
    fullDescription:
      "Read tracked artifacts from the sync repository and materialize them back onto local paths under your home directory. Secret artifacts are decrypted with the configured age identity before they are written locally.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const result = await pullChanges(
      {
        dryRun: flags.dryRun ?? false,
        profile: flags.profile,
      },
      createProgressReporter(verbose),
    );

    print(formatPullOutput(result, verbose));
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview local file updates only",
        kind: "boolean",
        optional: true,
      },
      profile: {
        brief: "Use a specific profile layer for this command",
        kind: "parsed",
        optional: true,
        parse: String,
        placeholder: "profile",
      },
      verbose: verboseFlag,
    },
  },
});

export default pullCommand;
