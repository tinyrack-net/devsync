import { buildCommand } from "@stricli/core";
import {
  getStatus,
  type StatusEntry,
  type StatusResult,
} from "#app/services/status.ts";
import {
  createProgressReporter,
  type DevsyncCliContext,
  isVerbose,
  print,
  verboseFlag,
} from "#app/services/terminal/cli-runtime.ts";
import { output } from "#app/services/terminal/output.ts";

const formatStatusEntry = (entry: StatusEntry) => {
  return `- ${entry.repoPath} -> ${entry.localPath} (${entry.kind}, ${entry.mode}${entry.profiles.length === 0 ? "" : `, profiles: ${entry.profiles.join(", ")}`})`;
};

const formatPlanPreview = (label: string, preview: readonly string[]) => {
  return `${label}: ${preview.length === 0 ? "none" : preview.join(", ")}`;
};

const formatStatusOutput = (result: StatusResult, verbose = false) => {
  return output(
    "Sync status",
    `profile: ${result.activeProfile ?? "none"}`,
    `tracked: ${result.entryCount} entries, ${result.recipientCount} recipients`,
    `push: ${result.push.plainFileCount} plain, ${result.push.encryptedFileCount} encrypted, ${result.push.symlinkCount} symlinks, ${result.push.directoryCount} dirs, ${result.push.deletedArtifactCount} stale`,
    `pull: ${result.pull.plainFileCount} plain, ${result.pull.decryptedFileCount} decrypted, ${result.pull.symlinkCount} symlinks, ${result.pull.directoryCount} dirs, ${result.pull.deletedLocalCount} remove`,
    verbose && formatPlanPreview("push preview", result.push.preview),
    verbose && formatPlanPreview("pull preview", result.pull.preview),
    ...(verbose
      ? [
          "entries:",
          ...(result.entries.length === 0
            ? ["- none"]
            : result.entries.map((entry) => formatStatusEntry(entry))),
          `sync dir: ${result.syncDirectory}`,
          `config: ${result.configPath}`,
        ]
      : []),
  );
};

type StatusFlags = {
  profile?: string;
  verbose?: boolean;
};

const statusCommand = buildCommand<StatusFlags, [], DevsyncCliContext>({
  docs: {
    brief: "Show planned push and pull changes for the current sync config",
    fullDescription:
      "Compare the tracked local files with the sync repository and report what push would write to the repository and what pull would write back locally.",
  },
  async func(flags) {
    const verbose = isVerbose(flags.verbose);
    const result = await getStatus({
      profile: flags.profile,
      reporter: createProgressReporter(verbose),
    });

    print(formatStatusOutput(result, verbose));
  },
  parameters: {
    flags: {
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

export default statusCommand;
