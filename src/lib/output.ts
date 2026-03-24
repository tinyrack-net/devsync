import { createColors } from "picocolors";

import { ensureTrailingNewline } from "#app/lib/string.js";
import type { SyncAddResult } from "#app/services/add.js";
import type { SyncDoctorResult } from "#app/services/doctor.js";
import { formatDevsyncError } from "#app/services/error.js";
import type { SyncForgetResult } from "#app/services/forget.js";
import type { SyncInitResult } from "#app/services/init.js";
import type {
  SyncProfileListResult,
  SyncProfileUpdateResult,
} from "#app/services/profile.js";
import type { SyncPullResult } from "#app/services/pull.js";
import type { SyncPushResult } from "#app/services/push.js";
import type { SyncSetResult } from "#app/services/set.js";
import type {
  SyncStatusEntry,
  SyncStatusResult,
} from "#app/services/status.js";

type OutputLine = false | null | string | undefined;
type OutputTone = "default" | "error" | "success" | "warn";
type FormatterOptions = Readonly<{
  verbose?: boolean;
}>;
type StatPair = readonly [label: string, value: number | string];

const OUTPUT_INDENT = "  ";
const colors = createColors(process.stdout.isTTY || process.stderr.isTTY);

const style = {
  detail: (value: string) => colors.dim(value),
  error: (value: string) => colors.bold(colors.red(value)),
  section: (value: string) => colors.bold(value),
  success: (value: string) => colors.bold(colors.green(value)),
  value: (value: string) => colors.reset(value),
  warn: (value: string) => colors.bold(colors.yellow(value)),
  default: (value: string) => colors.bold(colors.cyan(value)),
};

const compactLines = (lines: OutputLine[]) => {
  return lines.filter(
    (line): line is string =>
      line !== undefined && line !== null && line !== false,
  );
};

const toneIcon = (tone: OutputTone) => {
  switch (tone) {
    case "error":
      return "✗";
    case "success":
      return "✓";
    case "warn":
      return "⚠";
    default:
      return "›";
  }
};

const toneStyle = (tone: OutputTone) => {
  switch (tone) {
    case "error":
      return style.error;
    case "success":
      return style.success;
    case "warn":
      return style.warn;
    default:
      return style.default;
  }
};

const pluralize = (
  count: number,
  singular: string,
  plural = `${singular}s`,
) => {
  return `${count} ${count === 1 ? singular : plural}`;
};

const stripTrailingPeriod = (value: string) => {
  return value.endsWith(".") ? value.slice(0, -1) : value;
};

const normalizeDoctorCheckId = (checkId: string) => {
  switch (checkId) {
    case "age":
      return "identity";
    case "local-paths":
      return "local";
    default:
      return checkId;
  }
};

const formatSetAction = (action: SyncSetResult["action"]) => {
  switch (action) {
    case "added":
      return "added override";
    case "removed":
      return "removed override";
    case "unchanged":
      return "unchanged";
    case "updated":
      return "updated";
  }
};

const formatSetReason = (result: SyncSetResult) => {
  switch (result.reason) {
    case "already-set":
      return `already ${result.mode}`;
    default:
      return undefined;
  }
};

const formatDoctorSummary = (checks: SyncDoctorResult["checks"]) => {
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

  return [
    pluralize(counts.ok, "ok"),
    pluralize(counts.warn, "warning"),
    ...(counts.fail > 0 ? [pluralize(counts.fail, "failure")] : []),
  ].join(", ");
};

const formatDoctorCheck = (
  check: SyncDoctorResult["checks"][number],
  labelWidth: number,
) => {
  const tone =
    check.level === "fail"
      ? "error"
      : check.level === "warn"
        ? "warn"
        : "success";

  return `${OUTPUT_INDENT}${toneStyle(tone)(toneIcon(tone))} ${style.detail(normalizeDoctorCheckId(check.checkId).padEnd(labelWidth))} ${style.value(stripTrailingPeriod(check.detail))}`;
};

const formatStatusEntry = (
  entry: SyncStatusEntry,
  widths: Readonly<{
    kind: number;
    mode: number;
    repoPath: number;
  }>,
) => {
  const profileSuffix =
    entry.profiles.length > 0
      ? ` ${style.detail(`[${entry.profiles.join(", ")}]`)}`
      : "";

  return `${OUTPUT_INDENT}${style.value(entry.repoPath.padEnd(widths.repoPath))}  ${style.value(entry.kind.padEnd(widths.kind))}  ${style.value(entry.mode.padEnd(widths.mode))}  ${style.detail("->")} ${style.value(entry.localPath)}${profileSuffix}`;
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

export const heading = (text: string, tone: OutputTone = "default") => {
  const icon = toneIcon(tone);

  return toneStyle(tone)(text.length > 0 ? `${icon} ${text}` : icon);
};

export const kv = (label: string, value: number | string, labelWidth = 9) => {
  return `${OUTPUT_INDENT}${style.detail(label.padEnd(labelWidth))} ${style.value(String(value))}`;
};

export const statLine = (...pairs: readonly StatPair[]) => {
  return `${OUTPUT_INDENT}${pairs
    .map(
      ([label, value]) =>
        `${style.detail(`${label}:`)} ${style.value(String(value))}`,
    )
    .join("  ")}`;
};

export const section = (title: string, leadingBlank = true) => {
  return `${leadingBlank ? "\n" : ""}${style.section(title)}`;
};

export const verboseFooter = (
  result: Readonly<{
    configPath: string;
    syncDirectory: string;
  }>,
  verbose = false,
) => {
  if (!verbose) {
    return [];
  }

  return [
    "",
    kv("sync dir", result.syncDirectory),
    kv("config", result.configPath),
  ];
};

export const formatErrorMessage = (message: Error | string) => {
  return output(...formatDevsyncError(message).split("\n").map(style.error));
};

export const formatSyncInitResult = (
  result: SyncInitResult,
  _options: FormatterOptions = {},
) => {
  return output(
    heading(
      result.alreadyInitialized
        ? "Sync directory already initialized"
        : "Initialized sync directory",
      result.alreadyInitialized ? "warn" : "success",
    ),
    kv("directory", result.syncDirectory),
    kv("config", result.configPath),
    kv("identity", result.identityFile),
    kv(
      "git",
      (() => {
        switch (result.gitAction) {
          case "cloned":
            return `cloned from ${result.gitSource}`;
          case "initialized":
            return "initialized new repository";
          default:
            return "using existing repository";
        }
      })(),
    ),
    kv(
      "age",
      result.generatedIdentity
        ? "generated a new local identity"
        : "using existing identity",
    ),
    "",
    `${OUTPUT_INDENT}${style.value(`${result.recipientCount} recipients, ${result.entryCount} entries`)}`,
  );
};

export const formatSyncAddResult = (
  result: SyncAddResult,
  options: FormatterOptions = {},
) => {
  const headline = !result.alreadyTracked
    ? "Tracked sync target"
    : result.changed
      ? "Updated sync target"
      : "Sync target already tracked";
  const tone = !result.alreadyTracked || result.changed ? "success" : "warn";

  return output(
    heading(headline, tone),
    kv("local", result.localPath),
    kv("repo", result.repoPath),
    kv("kind", result.kind),
    kv("mode", result.mode),
    result.profiles.length > 0 && kv("profiles", result.profiles.join(", ")),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncForgetResult = (
  result: SyncForgetResult,
  options: FormatterOptions = {},
) => {
  return output(
    heading(`Untracked ${result.repoPath}`, "success"),
    kv("local", result.localPath),
    kv(
      "removed",
      `${result.plainArtifactCount} plain, ${result.secretArtifactCount} secret`,
    ),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncSetResult = (
  result: SyncSetResult,
  options: FormatterOptions = {},
) => {
  const reason = formatSetReason(result);

  return output(
    heading(
      result.action === "unchanged"
        ? "Sync mode unchanged"
        : "Updated sync mode",
      result.action === "unchanged" ? "warn" : "success",
    ),
    kv("target", result.repoPath),
    kv("mode", result.mode),
    kv("action", formatSetAction(result.action)),
    reason !== undefined && kv("detail", reason),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncPushResult = (
  result: SyncPushResult,
  options: FormatterOptions = {},
) => {
  return output(
    heading(
      result.dryRun
        ? "Dry run -- no changes made"
        : "Pushed to sync repository",
      result.dryRun ? "warn" : "success",
    ),
    statLine(
      ["plain", result.plainFileCount],
      ["encrypted", result.encryptedFileCount],
      ["symlinks", result.symlinkCount],
      ["dirs", result.directoryCount],
      [result.dryRun ? "would remove" : "removed", result.deletedArtifactCount],
    ),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncPullResult = (
  result: SyncPullResult,
  options: FormatterOptions = {},
) => {
  return output(
    heading(
      result.dryRun
        ? "Dry run -- no changes made"
        : "Pulled from sync repository",
      result.dryRun ? "warn" : "success",
    ),
    statLine(
      ["plain", result.plainFileCount],
      ["decrypted", result.decryptedFileCount],
      ["symlinks", result.symlinkCount],
      ["dirs", result.directoryCount],
      [result.dryRun ? "would remove" : "removed", result.deletedLocalCount],
    ),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncStatusResult = (
  result: SyncStatusResult,
  options: FormatterOptions = {},
) => {
  const widths = result.entries.reduce(
    (accumulator, entry) => ({
      kind: Math.max(accumulator.kind, entry.kind.length),
      mode: Math.max(accumulator.mode, entry.mode.length),
      repoPath: Math.max(accumulator.repoPath, entry.repoPath.length),
    }),
    {
      kind: "directory".length,
      mode: "normal".length,
      repoPath: 0,
    },
  );

  return output(
    section("Sync Status", false),
    kv("profile", result.activeProfile ?? "none"),
    kv(
      "entries",
      `${result.entryCount} tracked, ${result.recipientCount} recipients`,
    ),
    section("Tracked Entries"),
    ...(result.entries.length === 0
      ? [`${OUTPUT_INDENT}${style.detail("none")}`]
      : result.entries.map((entry) => formatStatusEntry(entry, widths))),
    section("Push Plan"),
    statLine(
      ["plain", result.push.plainFileCount],
      ["encrypted", result.push.encryptedFileCount],
      ["symlinks", result.push.symlinkCount],
      ["dirs", result.push.directoryCount],
      ["stale", result.push.deletedArtifactCount],
    ),
    section("Pull Plan"),
    statLine(
      ["plain", result.pull.plainFileCount],
      ["decrypted", result.pull.decryptedFileCount],
      ["symlinks", result.pull.symlinkCount],
      ["dirs", result.pull.directoryCount],
      ["remove", result.pull.deletedLocalCount],
    ),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncDoctorResult = (
  result: SyncDoctorResult,
  options: FormatterOptions = {},
) => {
  const labelWidth = result.checks.reduce((width, check) => {
    return Math.max(width, normalizeDoctorCheckId(check.checkId).length);
  }, 0);

  return output(
    heading(
      `Doctor ${result.hasFailures ? "found issues" : "passed"} -- ${formatDoctorSummary(result.checks)}`,
      result.hasFailures ? "error" : result.hasWarnings ? "warn" : "success",
    ),
    "",
    ...result.checks.map((check) => formatDoctorCheck(check, labelWidth)),
    ...verboseFooter(result, options.verbose),
  );
};

export const formatSyncProfileListResult = (
  result: SyncProfileListResult,
  options: FormatterOptions = {},
) => {
  return output(
    section("Profiles", false),
    kv("active", result.activeProfile ?? "none"),
    kv(
      "available",
      result.availableProfiles.length === 0
        ? "none"
        : result.availableProfiles.join(", "),
    ),
    section("Assignments"),
    ...(result.assignments.length === 0
      ? [`${OUTPUT_INDENT}${style.detail("none")}`]
      : result.assignments.map((assignment) => {
          return `${OUTPUT_INDENT}${style.value(assignment.entryRepoPath)}  ${style.detail(`[${assignment.profiles.join(", ")}]`)}`;
        })),
    result.activeProfile === undefined &&
      result.assignments.length > 0 &&
      heading(
        "No active profile set; restricted entries will be skipped",
        "warn",
      ),
    ...verboseFooter(
      {
        configPath: result.globalConfigPath,
        syncDirectory: result.syncDirectory,
      },
      options.verbose,
    ),
  );
};

export const formatSyncProfileUpdateResult = (
  result: SyncProfileUpdateResult,
  options: FormatterOptions = {},
) => {
  return output(
    heading(
      result.action === "use"
        ? `Updated active profile to ${result.activeProfile}`
        : "Cleared active profile",
      "success",
    ),
    result.warning !== undefined &&
      heading(stripTrailingPeriod(result.warning), "warn"),
    ...verboseFooter(
      {
        configPath: result.globalConfigPath,
        syncDirectory: result.syncDirectory,
      },
      options.verbose,
    ),
  );
};
