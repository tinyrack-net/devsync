import { buildCommand } from "@stricli/core";
import { type PushResult, pushChanges } from "#app/services/push.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";

const formatPushOutput = (result: PushResult, verbose = false) => {
  return output(
    result.dryRun ? "Dry run: push preview" : "Push complete",
    `changes: ${result.plainFileCount} plain, ${result.encryptedFileCount} encrypted, ${result.symlinkCount} symlinks, ${result.directoryCount} dirs`,
    `${result.dryRun ? "cleanup preview" : "cleanup"}: ${result.deletedArtifactCount} ${result.dryRun ? "artifacts would be removed" : "artifacts removed"}`,
    verbose && `sync dir: ${result.syncDirectory}`,
    verbose && `config: ${result.configPath}`,
  );
};

type PushFlags = {
  dryRun?: boolean;
  profile?: string;
  verbose?: boolean;
};

const pushCommand = buildCommand<PushFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Mirror local config into the git-backed sync repository",
    fullDescription:
      "Collect the current state of tracked local files and directories, then update the sync repository artifacts to match. Secret targets are encrypted before they are written into the repository.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const result = await pushChanges(
      {
        dryRun: flags.dryRun ?? false,
        profile: flags.profile,
      },
      createProgressReporter(verbose),
    );

    print(formatPushOutput(result, verbose));
  },
  parameters: {
    flags: {
      dryRun: {
        brief: "Preview repository updates only",
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

export default pushCommand;
