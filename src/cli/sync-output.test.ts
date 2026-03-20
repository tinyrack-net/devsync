import { describe, expect, it } from "vitest";

import {
  formatSyncAddResult,
  formatSyncForgetResult,
  formatSyncInitResult,
  formatSyncPullResult,
  formatSyncPushResult,
  formatSyncSetResult,
} from "#app/cli/sync-output.ts";

describe("sync output formatting", () => {
  it("formats init results for cloned repositories", () => {
    expect(
      formatSyncInitResult({
        alreadyInitialized: false,
        configPath: "/tmp/sync/config.json",
        entryCount: 2,
        generatedIdentity: true,
        gitAction: "cloned",
        gitSource: "/tmp/remote",
        identityFile: "/tmp/xdg/devsync/age/keys.txt",
        recipientCount: 3,
        ruleCount: 4,
        syncDirectory: "/tmp/sync",
      }),
    ).toBe(
      [
        "Initialized sync directory.",
        "Sync directory: /tmp/sync",
        "Config file: /tmp/sync/config.json",
        "Age identity file: /tmp/xdg/devsync/age/keys.txt",
        "Git repository: cloned from /tmp/remote",
        "Age bootstrap: generated a new local identity.",
        "Summary: 3 recipients, 2 entries, 4 rules.",
        "",
      ].join("\n"),
    );
  });

  it("formats add, forget, and set results", () => {
    expect(
      formatSyncAddResult({
        alreadyTracked: false,
        configPath: "/tmp/sync/config.json",
        kind: "file",
        localPath: "/tmp/home/.zshrc",
        mode: "secret",
        repoPath: ".zshrc",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Added sync target.\n");
    expect(
      formatSyncForgetResult({
        configPath: "/tmp/sync/config.json",
        localPath: "/tmp/home/.zshrc",
        plainArtifactCount: 1,
        repoPath: ".zshrc",
        secretArtifactCount: 2,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Removed repo artifacts: 1 plain, 2 secret.\n");
    expect(
      formatSyncSetResult({
        action: "updated",
        configPath: "/tmp/sync/config.json",
        entryRepoPath: "bundle",
        localPath: "/tmp/home/bundle/private.json",
        mode: "ignore",
        repoPath: "bundle/private.json",
        scope: "exact",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Scope: exact rule\nAction: updated\n");
  });

  it("formats push and pull dry-run summaries", () => {
    expect(
      formatSyncPushResult({
        configPath: "/tmp/sync/config.json",
        deletedArtifactCount: 4,
        directoryCount: 1,
        dryRun: true,
        encryptedFileCount: 2,
        plainFileCount: 3,
        symlinkCount: 1,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("No filesystem changes were made.\n");
    expect(
      formatSyncPullResult({
        configPath: "/tmp/sync/config.json",
        decryptedFileCount: 2,
        deletedLocalCount: 5,
        directoryCount: 1,
        dryRun: true,
        plainFileCount: 3,
        symlinkCount: 1,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain(
      "local paths would be removed.\nNo filesystem changes were made.\n",
    );
  });
});
