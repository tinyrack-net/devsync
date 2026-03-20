import { describe, expect, it } from "vitest";

import {
  formatSyncAddResult,
  formatSyncDoctorResult,
  formatSyncForgetResult,
  formatSyncInitResult,
  formatSyncListResult,
  formatSyncPullResult,
  formatSyncPushResult,
  formatSyncSetResult,
  formatSyncStatusResult,
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

  it("formats list, status, and doctor results", () => {
    expect(
      formatSyncListResult({
        configPath: "/tmp/sync/config.json",
        entries: [
          {
            kind: "directory",
            localPath: "/tmp/home/.config/tool",
            mode: "normal",
            name: ".config/tool",
            overrides: [{ mode: "secret", selector: "token.json" }],
            repoPath: ".config/tool",
          },
        ],
        recipientCount: 1,
        ruleCount: 1,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("override token.json: secret\n");
    expect(
      formatSyncStatusResult({
        configPath: "/tmp/sync/config.json",
        entryCount: 1,
        pull: {
          configPath: "/tmp/sync/config.json",
          decryptedFileCount: 1,
          deletedLocalCount: 2,
          directoryCount: 1,
          dryRun: true,
          plainFileCount: 0,
          preview: ["bundle", "bundle/token.txt"],
          symlinkCount: 0,
          syncDirectory: "/tmp/sync",
        },
        push: {
          configPath: "/tmp/sync/config.json",
          deletedArtifactCount: 1,
          directoryCount: 1,
          dryRun: true,
          encryptedFileCount: 1,
          plainFileCount: 0,
          preview: ["bundle", "bundle/token.txt"],
          symlinkCount: 0,
          syncDirectory: "/tmp/sync",
        },
        recipientCount: 1,
        ruleCount: 0,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Push preview: bundle, bundle/token.txt\n");
    expect(
      formatSyncDoctorResult({
        checks: [
          { detail: "ok", level: "ok", name: "git" },
          { detail: "warn", level: "warn", name: "entries" },
          { detail: "fail", level: "fail", name: "age" },
        ],
        configPath: "/tmp/sync/config.json",
        hasFailures: true,
        hasWarnings: true,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Summary: 1 ok, 1 warnings, 1 failures.\n");
  });
});
