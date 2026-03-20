import { describe, expect, it } from "vitest";

import {
  bullets,
  formatErrorMessage,
  formatSyncAddResult,
  formatSyncDoctorResult,
  formatSyncForgetResult,
  formatSyncInitResult,
  formatSyncListResult,
  formatSyncPullResult,
  formatSyncPushResult,
  formatSyncSetResult,
  formatSyncStatusResult,
  levelTag,
  line,
  output,
  preview,
  summary,
} from "#app/lib/output.ts";

describe("output primitives", () => {
  it("joins non-empty lines with a trailing newline", () => {
    expect(output("one", undefined, false, null, "two")).toBe("one\ntwo\n");
  });

  it("formats labeled lines and summaries", () => {
    expect(line("Config file", "/tmp/sync/config.json")).toBe(
      "Config file: /tmp/sync/config.json",
    );
    expect(summary("1 recipient", "2 entries")).toBe(
      "Summary: 1 recipient, 2 entries",
    );
  });

  it("formats bullets and previews", () => {
    expect(bullets(["alpha", "beta"])).toEqual(["  - alpha", "  - beta"]);
    expect(preview("Push preview", [], "no tracked paths")).toEqual([
      "Push preview: no tracked paths",
    ]);
    expect(
      preview(
        "Push preview",
        ["bundle", "bundle/token.txt"],
        "no tracked paths",
      ),
    ).toEqual(["Push preview: 2 paths", "  - bundle", "  - bundle/token.txt"]);
  });

  it("formats doctor level tags", () => {
    expect(levelTag("ok")).toBe("OK");
    expect(levelTag("warn")).toBe("WARN");
    expect(levelTag("fail")).toBe("FAIL");
  });

  it("formats error messages with a trailing newline", () => {
    expect(formatErrorMessage("Directory targets require --recursive")).toBe(
      "Directory targets require --recursive\n",
    );
  });

  it("formats structured error messages with details and hints", async () => {
    const { DevsyncError } = await import("#app/services/error.ts");

    expect(
      formatErrorMessage(
        new DevsyncError("Sync target does not exist.", {
          details: ["Target: /tmp/home/.zshrc"],
          hint: "Create the file first.",
        }),
      ),
    ).toBe(
      [
        "Sync target does not exist.",
        "Target: /tmp/home/.zshrc",
        "Hint: Create the file first.",
        "",
      ].join("\n"),
    );
  });
});

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
        "Summary: 3 recipients, 2 entries, 4 rules",
        "",
      ].join("\n"),
    );
  });

  it("formats init results for initialized and existing repositories", () => {
    expect(
      formatSyncInitResult({
        alreadyInitialized: true,
        configPath: "/tmp/sync/config.json",
        entryCount: 0,
        generatedIdentity: false,
        gitAction: "initialized",
        gitSource: undefined,
        identityFile: "/tmp/xdg/devsync/age/keys.txt",
        recipientCount: 1,
        ruleCount: 0,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Git repository: initialized new repository\n");
    expect(
      formatSyncInitResult({
        alreadyInitialized: true,
        configPath: "/tmp/sync/config.json",
        entryCount: 0,
        generatedIdentity: false,
        gitAction: "existing",
        gitSource: undefined,
        identityFile: "/tmp/xdg/devsync/age/keys.txt",
        recipientCount: 1,
        ruleCount: 0,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Git repository: using existing repository\n");
  });

  it("formats add, forget, and set results", () => {
    expect(
      formatSyncAddResult({
        alreadyTracked: true,
        configPath: "/tmp/sync/config.json",
        kind: "file",
        localPath: "/tmp/home/.zshrc",
        mode: "secret",
        repoPath: ".zshrc",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Sync target already tracked.\n");
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
        scope: "subtree",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Scope: subtree rule\nAction: updated\n");
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
      "Summary: 3 plain files, 2 decrypted files, 1 symlinks, 1 directory roots, 5 local paths would be removed\nNo filesystem changes were made.\n",
    );
  });

  it("formats list results with overrides", () => {
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
    ).toContain("  override token.json: secret\n");
  });

  it("formats list results with no entries", () => {
    expect(
      formatSyncListResult({
        configPath: "/tmp/sync/config.json",
        entries: [],
        recipientCount: 1,
        ruleCount: 0,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Entries: none\n");
  });

  it("formats status previews as bullet lists", () => {
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
    ).toContain("Push preview: 2 paths\n  - bundle\n  - bundle/token.txt\n");
  });

  it("formats empty status previews", () => {
    expect(
      formatSyncStatusResult({
        configPath: "/tmp/sync/config.json",
        entryCount: 0,
        pull: {
          configPath: "/tmp/sync/config.json",
          decryptedFileCount: 0,
          deletedLocalCount: 0,
          directoryCount: 0,
          dryRun: true,
          plainFileCount: 0,
          preview: [],
          symlinkCount: 0,
          syncDirectory: "/tmp/sync",
        },
        push: {
          configPath: "/tmp/sync/config.json",
          deletedArtifactCount: 0,
          directoryCount: 0,
          dryRun: true,
          encryptedFileCount: 0,
          plainFileCount: 0,
          preview: [],
          symlinkCount: 0,
          syncDirectory: "/tmp/sync",
        },
        recipientCount: 1,
        ruleCount: 0,
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Push preview: no tracked paths\n");
  });

  it("formats doctor results", () => {
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
    ).toBe(
      [
        "Sync doctor found issues.",
        "Sync directory: /tmp/sync",
        "Config file: /tmp/sync/config.json",
        "Summary: 1 ok, 1 warnings, 1 failures",
        "OK git: ok",
        "WARN entries: warn",
        "FAIL age: fail",
        "",
      ].join("\n"),
    );
  });
});
