import { createColors } from "picocolors";

import { ensureTrailingNewline } from "#app/lib/string.ts";
import type { SyncAddResult } from "#app/services/add.ts";
import type { SyncDoctorResult } from "#app/services/doctor.ts";
import type { SyncForgetResult } from "#app/services/forget.ts";
import type { SyncInitResult } from "#app/services/init.ts";
import type { SyncListResult } from "#app/services/list.ts";
import type { SyncPullResult } from "#app/services/pull.ts";
import type { SyncPushResult } from "#app/services/push.ts";
import type { SyncSetResult } from "#app/services/set.ts";
import type { SyncStatusResult } from "#app/services/status.ts";

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

export const formatErrorMessage = (message: string) => {
  return output(style.error(message));
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

const formatSetScope = (scope: SyncSetResult["scope"]) => {
  switch (scope) {
    case "default":
      return "entry default";
    case "subtree":
      return "subtree rule";
    default:
      return "exact rule";
  }
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

const formatTrackedEntry = (entry: SyncListResult["entries"][number]) => {
  const lines = [
    `${style.bullet("-")} ${style.value(entry.repoPath)} ${style.detail(`[${entry.kind}, ${entry.mode}] -> ${entry.localPath}`)}`,
    ...entry.overrides.map((override) => {
      return `${OUTPUT_INDENT}${style.detail("override")} ${style.value(override.selector)}: ${style.value(override.mode)}`;
    }),
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

const formatDoctorCounts = (result: SyncDoctorResult) => {
  const counts = result.checks.reduce(
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
      `${result.ruleCount} rules`,
    ),
  );
};

export const formatSyncAddResult = (result: SyncAddResult) => {
  return output(
    formatHeadline(
      result.alreadyTracked
        ? "Sync target already tracked."
        : "Added sync target.",
      result.alreadyTracked ? "warn" : "success",
    ),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    line("Local path", result.localPath),
    line("Repository path", result.repoPath),
    line("Kind", result.kind),
    line("Mode", result.mode),
  );
};

export const formatSyncForgetResult = (result: SyncForgetResult) => {
  return output(
    formatHeadline("Forgot sync target.", "warn"),
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
    line("Scope", formatSetScope(result.scope)),
    line("Action", result.action),
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

export const formatSyncListResult = (result: SyncListResult) => {
  return output(
    formatHeadline("Tracked sync configuration."),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    summary(
      `${result.recipientCount} recipients`,
      `${result.entries.length} entries`,
      `${result.ruleCount} rules`,
    ),
    ...(result.entries.length === 0
      ? [line("Entries", "none")]
      : result.entries.flatMap(formatTrackedEntry)),
  );
};

export const formatSyncStatusResult = (result: SyncStatusResult) => {
  return output(
    formatHeadline("Sync status overview."),
    line("Sync directory", result.syncDirectory),
    line("Config file", result.configPath),
    summary(
      `${result.recipientCount} recipients`,
      `${result.entryCount} entries`,
      `${result.ruleCount} rules`,
    ),
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
    formatDoctorCounts(result),
    ...result.checks.map(formatDoctorCheck),
  );
};
