import { ensureTrailingNewline } from "#app/lib/string.ts";
import type { createSyncManager } from "#app/services/sync/index.ts";

type SyncManager = ReturnType<typeof createSyncManager>;
type SyncInitResult = Awaited<ReturnType<SyncManager["init"]>>;
type SyncAddResult = Awaited<ReturnType<SyncManager["add"]>>;
type SyncForgetResult = Awaited<ReturnType<SyncManager["forget"]>>;
type SyncPushResult = Awaited<ReturnType<SyncManager["push"]>>;
type SyncPullResult = Awaited<ReturnType<SyncManager["pull"]>>;

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
    `Summary: ${result.recipientCount} recipients, ${result.entryCount} entries, ${result.secretGlobCount} secret globs.`,
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
    `Secret glob: ${result.secretGlobAdded ? "added" : "unchanged"}`,
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
    `Secret glob: ${result.secretGlobRemoved ? "removed" : "unchanged"}`,
    `Removed repo artifacts: ${result.plainArtifactCount} plain, ${result.secretArtifactCount} secret.`,
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
