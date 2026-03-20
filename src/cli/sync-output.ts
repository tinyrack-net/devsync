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

export const formatSyncInitResult = (result: SyncInitResult) => {
  const lines = [
    result.alreadyInitialized
      ? "Sync directory already initialized."
      : "Initialized sync directory.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Age identity file: ${result.identityFile}`,
    (() => {
      switch (result.gitAction) {
        case "cloned":
          return `Git repository: cloned from ${result.gitSource}`;
        case "initialized":
          return "Git repository: initialized new repository";
        default:
          return "Git repository: using existing repository";
      }
    })(),
    ...(result.generatedIdentity
      ? ["Age bootstrap: generated a new local identity."]
      : []),
    `Summary: ${result.recipientCount} recipients, ${result.entryCount} entries, ${result.ruleCount} rules.`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncAddResult = (result: SyncAddResult) => {
  const lines = [
    result.alreadyTracked
      ? "Sync target already tracked."
      : "Added sync target.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Local path: ${result.localPath}`,
    `Repository path: ${result.repoPath}`,
    `Kind: ${result.kind}`,
    `Mode: ${result.mode}`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncForgetResult = (result: SyncForgetResult) => {
  const lines = [
    "Forgot sync target.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Local path: ${result.localPath}`,
    `Repository path: ${result.repoPath}`,
    `Removed repo artifacts: ${result.plainArtifactCount} plain, ${result.secretArtifactCount} secret.`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
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

export const formatSyncSetResult = (result: SyncSetResult) => {
  const lines = [
    result.action === "unchanged"
      ? "Sync mode unchanged."
      : "Updated sync mode.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Owning entry: ${result.entryRepoPath}`,
    `Target repository path: ${result.repoPath}`,
    `Mode: ${result.mode}`,
    `Scope: ${formatSetScope(result.scope)}`,
    `Action: ${result.action}`,
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncPushResult = (result: SyncPushResult) => {
  const lines = result.dryRun
    ? [
        "Dry run for sync push.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.encryptedFileCount} encrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedArtifactCount} stale repository artifacts would be removed.`,
        "No filesystem changes were made.",
      ]
    : [
        "Synchronized local config into the sync repository.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.encryptedFileCount} encrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedArtifactCount} stale repository artifacts removed.`,
      ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncPullResult = (result: SyncPullResult) => {
  const lines = result.dryRun
    ? [
        "Dry run for sync pull.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.decryptedFileCount} decrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedLocalCount} local paths would be removed.`,
        "No filesystem changes were made.",
      ]
    : [
        "Applied sync repository to local config.",
        `Sync directory: ${result.syncDirectory}`,
        `Config file: ${result.configPath}`,
        `Summary: ${result.plainFileCount} plain files, ${result.decryptedFileCount} decrypted files, ${result.symlinkCount} symlinks, ${result.directoryCount} directory roots, ${result.deletedLocalCount} local paths removed.`,
      ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncListResult = (result: SyncListResult) => {
  const lines = [
    "Tracked sync configuration.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Summary: ${result.recipientCount} recipients, ${result.entries.length} entries, ${result.ruleCount} rules.`,
    ...(result.entries.length === 0
      ? ["Entries: none"]
      : result.entries.flatMap((entry) => {
          return [
            `- ${entry.repoPath} [${entry.kind}, ${entry.mode}] -> ${entry.localPath}`,
            ...(entry.overrides.length === 0
              ? []
              : entry.overrides.map((override) => {
                  return `  override ${override.selector}: ${override.mode}`;
                })),
          ];
        })),
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncStatusResult = (result: SyncStatusResult) => {
  const lines = [
    "Sync status overview.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Summary: ${result.recipientCount} recipients, ${result.entryCount} entries, ${result.ruleCount} rules.`,
    `Push plan: ${result.push.plainFileCount} plain files, ${result.push.encryptedFileCount} encrypted files, ${result.push.symlinkCount} symlinks, ${result.push.directoryCount} directory roots, ${result.push.deletedArtifactCount} stale repository artifacts.`,
    ...(result.push.preview.length === 0
      ? ["Push preview: no tracked paths"]
      : [`Push preview: ${result.push.preview.join(", ")}`]),
    `Pull plan: ${result.pull.plainFileCount} plain files, ${result.pull.decryptedFileCount} decrypted files, ${result.pull.symlinkCount} symlinks, ${result.pull.directoryCount} directory roots, ${result.pull.deletedLocalCount} local paths.`,
    ...(result.pull.preview.length === 0
      ? ["Pull preview: no tracked paths"]
      : [`Pull preview: ${result.pull.preview.join(", ")}`]),
  ];

  return ensureTrailingNewline(lines.join("\n"));
};

export const formatSyncDoctorResult = (result: SyncDoctorResult) => {
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
  const lines = [
    result.hasFailures ? "Sync doctor found issues." : "Sync doctor passed.",
    `Sync directory: ${result.syncDirectory}`,
    `Config file: ${result.configPath}`,
    `Summary: ${counts.ok} ok, ${counts.warn} warnings, ${counts.fail} failures.`,
    ...result.checks.map((check) => {
      return `[${check.level.toUpperCase()}] ${check.name}: ${check.detail}`;
    }),
  ];

  return ensureTrailingNewline(lines.join("\n"));
};
