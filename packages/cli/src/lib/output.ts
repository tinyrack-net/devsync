import { createColors } from "picocolors";
import { formatDevsyncError } from "#app/lib/error.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";
import type { DoctorResult } from "#app/services/doctor.ts";
import type { InitResult } from "#app/services/init.ts";
import type {
  ProfileListResult,
  ProfileUpdateResult,
} from "#app/services/profile.ts";
import type { PullResult } from "#app/services/pull.ts";
import type { PushResult } from "#app/services/push.ts";
import type { SetModeResult } from "#app/services/set.ts";
import type { StatusEntry, StatusResult } from "#app/services/status.ts";
import type { TrackResult } from "#app/services/track.ts";
import type { UntrackResult } from "#app/services/untrack.ts";

type OutputLine = false | null | string | undefined;
type OutputTone = "default" | "error" | "success" | "warn";
type FormatterOptions = Readonly<{
  verbose?: boolean;
}>;
type ProgressFormatOptions = Readonly<{
  detail?: boolean;
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

/**
 * @description
 * Removes non-renderable output fragments before they are joined into text.
 */
const compactLines = (lines: OutputLine[]) => {
  return lines.filter(
    (line): line is string =>
      line !== undefined && line !== null && line !== false,
  );
};

/**
 * @description
 * Selects the leading symbol used for a given output tone.
 */
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

/**
 * @description
 * Selects the text styling function for a given output tone.
 */
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

/**
 * @description
 * Builds count labels with the correct singular or plural noun.
 */
const pluralize = (
  count: number,
  singular: string,
  plural = `${singular}s`,
) => {
  return `${count} ${count === 1 ? singular : plural}`;
};

/**
 * @description
 * Normalizes messages that should be displayed without a trailing period.
 */
const stripTrailingPeriod = (value: string) => {
  return value.endsWith(".") ? value.slice(0, -1) : value;
};

/**
 * @description
 * Maps doctor check identifiers to the labels shown in CLI output.
 */
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

/**
 * @description
 * Formats sync mode change actions for result output.
 */
const formatSetAction = (action: SetModeResult["action"]) => {
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

/**
 * @description
 * Formats the optional explanation attached to a sync mode result.
 */
const formatSetReason = (result: SetModeResult) => {
  switch (result.reason) {
    case "already-set":
      return `already ${result.mode}`;
    default:
      return undefined;
  }
};

/**
 * @description
 * Summarizes doctor check outcomes for the command heading.
 */
const formatDoctorSummary = (checks: DoctorResult["checks"]) => {
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

/**
 * @description
 * Formats a single doctor check row for terminal output.
 */
const formatDoctorCheck = (
  check: DoctorResult["checks"][number],
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

/**
 * @description
 * Formats one tracked sync entry for the status view.
 */
const formatStatusEntry = (
  entry: StatusEntry,
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

/**
 * @description
 * Joins output lines into a newline-terminated CLI message.
 */
export const output = (...lines: OutputLine[]) => {
  return ensureTrailingNewline(compactLines(lines).join("\n"));
};

/**
 * @description
 * Writes preformatted output directly to stdout.
 */
export const writeStdout = (value: string) => {
  process.stdout.write(value);
};

/**
 * @description
 * Writes preformatted output directly to stderr.
 */
export const writeStderr = (value: string) => {
  process.stderr.write(value);
};

/**
 * @description
 * Formats progress updates for phase and detail reporting.
 */
export const formatProgressMessage = (
  message: string,
  options: ProgressFormatOptions = {},
) => {
  return ensureTrailingNewline(
    options.detail
      ? `${OUTPUT_INDENT}${style.detail(message)}`
      : `${toneStyle("default")(toneIcon("default"))} ${style.value(message)}`,
  );
};

/**
 * @description
 * Builds a styled heading line for command output.
 */
export const heading = (text: string, tone: OutputTone = "default") => {
  const icon = toneIcon(tone);

  return toneStyle(tone)(text.length > 0 ? `${icon} ${text}` : icon);
};

/**
 * @description
 * Formats a labeled key-value line for command output.
 */
export const kv = (label: string, value: number | string, labelWidth = 9) => {
  return `${OUTPUT_INDENT}${style.detail(label.padEnd(labelWidth))} ${style.value(String(value))}`;
};

/**
 * @description
 * Formats compact command statistics on a single line.
 */
export const statLine = (...pairs: readonly StatPair[]) => {
  return `${OUTPUT_INDENT}${pairs
    .map(
      ([label, value]) =>
        `${style.detail(`${label}:`)} ${style.value(String(value))}`,
    )
    .join("  ")}`;
};

/**
 * @description
 * Builds a styled section heading for multi-part output.
 */
export const section = (title: string, leadingBlank = true) => {
  return `${leadingBlank ? "\n" : ""}${style.section(title)}`;
};

/**
 * @description
 * Adds verbose-only footer metadata to formatted command results.
 */
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

/**
 * @description
 * Formats supported error values as styled CLI error output.
 */
export const formatErrorMessage = (message: Error | string) => {
  return output(...formatDevsyncError(message).split("\n").map(style.error));
};

/**
 * @description
 * Formats the result of initializing a sync directory.
 */
export const formatInitResult = (
  result: InitResult,
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

/**
 * @description
 * Formats the result of tracking or updating a sync target.
 */
export const formatTrackResult = (
  result: TrackResult,
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

/**
 * @description
 * Formats the result of removing a tracked sync target.
 */
export const formatUntrackResult = (
  result: UntrackResult,
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

/**
 * @description
 * Formats the result of changing a sync mode override.
 */
export const formatSetModeResult = (
  result: SetModeResult,
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

/**
 * @description
 * Formats push results and artifact counts for CLI output.
 */
export const formatPushResult = (
  result: PushResult,
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

/**
 * @description
 * Formats pull results and local change counts for CLI output.
 */
export const formatPullResult = (
  result: PullResult,
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

/**
 * @description
 * Formats the sync status view, including tracked entries and planned changes.
 */
export const formatStatusResult = (
  result: StatusResult,
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

/**
 * @description
 * Formats doctor findings and their overall health summary.
 */
export const formatDoctorResult = (
  result: DoctorResult,
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

/**
 * @description
 * Formats the available profiles and their current assignments.
 */
export const formatProfileListResult = (
  result: ProfileListResult,
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

/**
 * @description
 * Formats the result of changing the active sync profile.
 */
export const formatProfileUpdateResult = (
  result: ProfileUpdateResult,
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
