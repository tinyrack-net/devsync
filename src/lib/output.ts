import { createColors } from "picocolors";

import { ensureTrailingNewline } from "#app/lib/string.js";
import type { SyncAddResult } from "#app/services/add.js";
import type { SyncDoctorResult } from "#app/services/doctor.js";
import { formatDevsyncError } from "#app/services/error.js";
import type { SyncForgetResult } from "#app/services/forget.js";
import type { SyncInitResult } from "#app/services/init.js";
import type {
  SyncMachineListResult,
  SyncMachineUpdateResult,
} from "#app/services/machine.js";
import type { SyncPullResult } from "#app/services/pull.js";
import type { SyncPushResult } from "#app/services/push.js";
import type { SyncSetResult } from "#app/services/set.js";
import type {
  SyncStatusEntry,
  SyncStatusResult,
} from "#app/services/status.js";

type OutputLine = false | null | string | undefined;

const OUTPUT_INDENT = "  ";
const colors = createColors(process.stdout.isTTY || process.stderr.isTTY);

const style = {
  bullet: (value: string) => colors.dim(value),
  detail: (value: string) => colors.dim(value),
  error: (value: string) => colors.bold(colors.red(value)),
  headline: (value: string) => colors.bold(colors.cyan(value)),
  success: (value: string) => colors.bold(colors.green(value)),
  value: (value: string) => colors.reset(value),
  warn: (value: string) => colors.bold(colors.yellow(value)),
};

const compactLines = (lines: OutputLine[]) => {
  return lines.filter(
    (line): line is string =>
      line !== undefined && line !== null && line !== false,
  );
};

export const output = (...lines: OutputLine[]) => {
  return ensureTrailingNewline(compactLines(lines).join("\n"));
};

export const writeStdout = (value: string) => {
  process.stdout.write(value);
};

export const writeStderr = (value: string) => {
  process.stderr.write(value);
};

export const line = (label: string, value: number | string) => {
  return `${style.detail(label)}: ${style.value(String(value))}`;
};

export const summary = (...parts: string[]) => {
  return line("Summary", parts.join(", "));
};

export const bullets = (items: readonly string[], indent = OUTPUT_INDENT) => {
  return items.map(
    (item) => `${indent}${style.bullet("-")} ${style.value(item)}`,
  );
};

export const preview = (
  label: string,
  items: readonly string[],
  emptyText: string,
) => {
  if (items.length === 0) {
    return [line(label, emptyText)];
  }

  return [
    line(label, `${items.length} path${items.length === 1 ? "" : "s"}`),
    ...bullets(items),
  ];
};

export const levelTag = (level: "fail" | "ok" | "warn") => {
  switch (level) {
    case "fail":
      return style.error("FAIL");
    case "warn":
      return style.warn("WARN");
    default:
      return style.success("OK");
  }
};

export const formatErrorMessage = (message: Error | string) => {
  return output(...formatDevsyncError(message).split("\n").map(style.error));
};

const formatHeadline = (
  message: string,
  tone: "default" | "error" | "success" | "warn" = "default",
) => {
  switch (tone) {
    case "error":
      return style.error(message);
    case "success":
      return style.success(message);
    case "warn":
      return style.warn(message);
    default:
      return style.headline(message);
  }
};

const formatSetReason = (
  reason: SyncSetResult["reason"],
  mode: SyncSetResult["mode"],
) => {
  switch (reason) {
    case "already-set":
      return `This target already has ${mode} mode.`;
    default:
      return undefined;
  }
};

const formatStoragePath = (repoPath: string) => {
  return `default/${repoPath}`;
};

const formatPushSummary = (result: SyncPushResult) => {
  return summary(
    `${result.plainFileCount} plain files`,
    `${result.encryptedFileCount} encrypted files`,
    `${result.symlinkCount} symlinks`,
    `${result.directoryCount} directory roots`,
    result.dryRun
      ? `${result.deletedArtifactCount} stale repository artifacts would be removed`
      : `${result.deletedArtifactCount} stale repository artifacts removed`,
  );
};

const formatPullSummary = (result: SyncPullResult) => {
  return summary(
    `${result.plainFileCount} plain files`,
    `${result.decryptedFileCount} decrypted files`,
    `${result.symlinkCount} symlinks`,
    `${result.directoryCount} directory roots`,
    result.dryRun
      ? `${result.deletedLocalCount} local paths would be removed`
      : `${result.deletedLocalCount} local paths removed`,
  );
};

const formatTrackedEntry = (entry: SyncStatusEntry) => {
  const lines = [
    `${style.bullet("-")} ${style.value(entry.repoPath)} ${style.detail(`[${entry.kind}, ${entry.mode}] -> ${entry.localPath}`)}`,
    `${OUTPUT_INDENT}${style.detail("storage")} ${style.value(formatStoragePath(entry.repoPath))}`,
    ...(entry.machines.length > 0
      ? [
          `${OUTPUT_INDENT}${style.detail("machines")} ${style.value(entry.machines.join(", "))}`,
        ]
      : []),
  ];

  return lines;
};

const formatPushPlan = (result: SyncStatusResult["push"]) => {
  return [
    line(
      "Push plan",
      `${result.plainFileCount} plain files, ${result.encryptedFileCount} encrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedArtifactCount} stale repository artifacts.`,
    ),
    ...preview("Push preview", result.preview, "no tracked paths"),
  ];
};

const formatPullPlan = (result: SyncStatusResult["pull"]) => {
  return [
    line(
      "Pull plan",
      `${result.plainFileCount} plain files, ${result.decryptedFileCount} decrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedLocalCount} local paths.`,
    ),
    ...preview("Pull preview", result.preview, "no tracked paths"),
  ];
};

const formatDoctorCounts = (checks: SyncDoctorResult["checks"]) => {
  const counts = checks.reduce(
    (accumulator, check) => {
      accumulator[check.level] += 1;

      return accumulator;
    },
    {
      fail: 0,
      ok: 0,
      warn: 0,
    },
  );

  return summary(
    `${counts.ok} ok`,
    `${counts.warn} warnings`,
    `${counts.fail} failures`,
  );
};

const formatDoctorCheck = (check: SyncDoctorResult["checks"][number]) => {
  return `${levelTag(check.level)} ${check.name}: ${check.detail}`;
};

export const formatSyncInitResult = (result: SyncInitResult) => {
  return output(
    formatHeadline(
      result.alreadyInitialized
        ? "Sync directory already initialized."
        : "Initialized sync directory.",
      result.alreadyInitialized ? "warn" : "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    line("Age identity file", result.identityFile),
    (() => {
      switch (result.gitAction) {
        case "cloned":
          return line("Git repository", `cloned from ${result.gitSource}`);
        case "initialized":
          return line("Git repository", "initialized new repository");
        default:
          return line("Git repository", "using existing repository");
      }
    })(),
    result.generatedIdentity &&
      "Age bootstrap: generated a new local identity.",
    summary(
      `${result.recipientCount} recipients`,
      `${result.entryCount} entries`,
    ),
  );
};

export const formatSyncAddResult = (result: SyncAddResult) => {
  const headline = !result.alreadyTracked
    ? "Tracked sync target."
    : result.changed
      ? "Updated sync target."
      : "Sync target already tracked.";
  const tone = !result.alreadyTracked || result.changed ? "success" : "warn";

  return output(
    formatHeadline(headline, tone),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    line("Local path", result.localPath),
    line("Repository path", result.repoPath),
    line("Repository storage", formatStoragePath(result.repoPath)),
    line("Kind", result.kind),
    line("Mode", result.mode),
    result.machines.length > 0 && line("Machines", result.machines.join(", ")),
  );
};

export const formatSyncForgetResult = (result: SyncForgetResult) => {
  return output(
    formatHeadline("Untracked sync target.", "warn"),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    line("Local path", result.localPath),
    line("Repository path", result.repoPath),
    line(
      "Removed repo artifacts",
      `${result.plainArtifactCount} plain, ${result.secretArtifactCount} secret.`,
    ),
  );
};

export const formatSyncSetResult = (result: SyncSetResult) => {
  return output(
    formatHeadline(
      result.action === "unchanged"
        ? "Sync mode unchanged."
        : "Updated sync mode.",
      result.action === "unchanged" ? "warn" : "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    line("Owning entry", result.entryRepoPath),
    line("Target repository path", result.repoPath),
    line("Mode", result.mode),
    line("Action", result.action),
    formatSetReason(result.reason, result.mode),
  );
};

export const formatSyncPushResult = (result: SyncPushResult) => {
  return output(
    formatHeadline(
      result.dryRun
        ? "Dry run for sync push."
        : "Synchronized local config into the sync repository.",
      result.dryRun ? "warn" : "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    formatPushSummary(result),
    result.dryRun && "No filesystem changes were made.",
  );
};

export const formatSyncPullResult = (result: SyncPullResult) => {
  return output(
    formatHeadline(
      result.dryRun
        ? "Dry run for sync pull."
        : "Applied sync repository to local config.",
      result.dryRun ? "warn" : "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    formatPullSummary(result),
    result.dryRun && "No filesystem changes were made.",
  );
};

export const formatSyncStatusResult = (result: SyncStatusResult) => {
  return output(
    formatHeadline("Sync status overview."),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    line("Active machine", result.activeMachine ?? "none"),
    summary(
      `${result.recipientCount} recipients`,
      `${result.entryCount} entries`,
    ),
    ...(result.entries.length === 0
      ? [line("Entries", "none")]
      : result.entries.flatMap(formatTrackedEntry)),
    ...formatPushPlan(result.push),
    ...formatPullPlan(result.pull),
  );
};

export const formatSyncDoctorResult = (result: SyncDoctorResult) => {
  return output(
    formatHeadline(
      result.hasFailures ? "Sync doctor found issues." : "Sync doctor passed.",
      result.hasFailures ? "error" : result.hasWarnings ? "warn" : "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    formatDoctorCounts(result.checks),
    ...result.checks.map(formatDoctorCheck),
  );
};

export const formatSyncMachineListResult = (result: SyncMachineListResult) => {
  const assignmentLines =
    result.assignments.length === 0
      ? [line("Assignments", "none")]
      : result.assignments.map(
          (a) =>
            `${OUTPUT_INDENT}${style.bullet("-")} ${style.value(a.entryRepoPath)} ${style.detail(`[${a.machines.join(", ")}]`)}`,
        );

  const noActiveMachine = result.activeMachine === undefined;
  const hasRestrictedEntries = result.assignments.length > 0;

  return output(
    formatHeadline("Sync machines overview."),
    line("Sync directory", result.syncDirectory),
    line("Global config", result.globalConfigPath),
    line("Active machines", result.activeMachine ?? "none"),
    summary(
      `${result.availableMachines.length} available machines`,
      `${result.assignments.length} assignments`,
      result.globalConfigExists
        ? "global config present"
        : "using implicit defaults",
    ),
    ...(result.availableMachines.length === 0
      ? [line("Machines", "none")]
      : preview("Machines", result.availableMachines, "none")),
    ...assignmentLines,
    noActiveMachine &&
      hasRestrictedEntries &&
      style.warn(
        "No active machine set. Entries restricted to specific machines will not sync.",
      ),
  );
};

export const formatSyncMachineUpdateResult = (
  result: SyncMachineUpdateResult,
) => {
  return output(
    formatHeadline(
      result.mode === "use"
        ? "Updated active sync machine."
        : "Cleared active sync machine.",
      "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Global config", result.globalConfigPath),
    result.machine !== undefined && line("Machine", result.machine),
    line("Active machines", result.activeMachine ?? "none"),
    result.warning !== undefined && style.warn(result.warning),
  );
};
