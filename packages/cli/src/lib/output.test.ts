import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatDoctorResult,
  formatErrorMessage,
  formatInitResult,
  formatProfileListResult,
  formatProfileUpdateResult,
  formatProgressMessage,
  formatPullResult,
  formatPushResult,
  formatSetModeResult,
  formatStatusResult,
  formatTrackResult,
  formatUntrackResult,
  heading,
  kv,
  output,
  section,
  statLine,
  verboseFooter,
  writeStderr,
  writeStdout,
} from "./output.ts";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
const ansiPattern = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replace(ansiPattern, "");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("output", () => {
  it("formats low-level helpers and verbose footers", () => {
    expect(output("first", undefined, false, null, "second")).toBe(
      "first\nsecond\n",
    );
    expect(stripAnsi(heading("", "error"))).toBe("✗");
    expect(stripAnsi(heading("Complete", "success"))).toBe("✓ Complete");
    expect(stripAnsi(kv("mode", "secret", 6))).toBe("  mode   secret");
    expect(stripAnsi(statLine(["plain", 2], ["secret", 1]))).toBe(
      "  plain: 2  secret: 1",
    );
    expect(stripAnsi(section("Sync Status", false))).toBe("Sync Status");
    expect(
      verboseFooter(
        {
          configPath: "/tmp/config.json",
          syncDirectory: "/tmp/sync",
        },
        false,
      ),
    ).toEqual([]);
    expect(
      verboseFooter(
        {
          configPath: "/tmp/config.json",
          syncDirectory: "/tmp/sync",
        },
        true,
      ).map(stripAnsi),
    ).toEqual(["", "  sync dir  /tmp/sync", "  config    /tmp/config.json"]);
  });

  it("writes directly to stdout and stderr", () => {
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderrWrite = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    writeStdout("hello");
    writeStderr("oops");

    expect(stdoutWrite).toHaveBeenCalledWith("hello");
    expect(stderrWrite).toHaveBeenCalledWith("oops");
  });

  it("formats progress messages for phase and detail output", () => {
    expect(stripAnsi(formatProgressMessage("Scanning local files..."))).toBe(
      "› Scanning local files...\n",
    );
    expect(
      stripAnsi(
        formatProgressMessage("scanned local file .config/zsh/.zshrc", {
          detail: true,
        }),
      ),
    ).toBe("  scanned local file .config/zsh/.zshrc\n");
  });

  it("formats errors and sync init results across initialization modes", () => {
    expect(stripAnsi(formatErrorMessage("first line\nsecond line"))).toBe(
      "first line\nsecond line\n",
    );

    expect(
      stripAnsi(
        formatInitResult({
          alreadyInitialized: false,
          configPath: "/tmp/config.json",
          entryCount: 3,
          generatedIdentity: true,
          gitAction: "cloned",
          gitSource: "git@example.com:dotfiles.git",
          identityFile: "/tmp/keys.txt",
          recipientCount: 2,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("git       cloned from git@example.com:dotfiles.git");

    expect(
      stripAnsi(
        formatInitResult({
          alreadyInitialized: true,
          configPath: "/tmp/config.json",
          entryCount: 1,
          generatedIdentity: false,
          gitAction: "existing",
          identityFile: "/tmp/keys.txt",
          recipientCount: 1,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("using existing repository");

    expect(
      stripAnsi(
        formatInitResult({
          alreadyInitialized: false,
          configPath: "/tmp/config.json",
          entryCount: 0,
          generatedIdentity: false,
          gitAction: "initialized",
          identityFile: "/tmp/keys.txt",
          recipientCount: 1,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("initialized new repository");
  });

  it("formats profile list and update results", () => {
    expect(
      stripAnsi(
        formatProfileListResult({
          activeProfile: "work",
          activeProfileMode: "single",
          assignments: [],
          availableProfiles: ["personal", "work"],
          globalConfigExists: true,
          globalConfigPath: "/tmp/config.json",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("available personal, work");

    expect(
      stripAnsi(
        formatProfileUpdateResult({
          activeProfile: "work",
          action: "use",
          globalConfigPath: "/tmp/config.json",
          profile: "work",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Updated active profile to work");

    expect(
      stripAnsi(
        formatProfileUpdateResult({
          action: "clear",
          globalConfigPath: "/tmp/config.json",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Cleared active profile");
  });

  it("formats profile warnings when assignments exist without an active profile", () => {
    expect(
      stripAnsi(
        formatProfileListResult(
          {
            activeProfileMode: "none",
            assignments: [
              {
                entryLocalPath: "/tmp/home/.gitconfig",
                entryRepoPath: ".gitconfig",
                profiles: ["work"],
              },
            ],
            availableProfiles: ["work"],
            globalConfigExists: true,
            globalConfigPath: "/tmp/config.json",
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("No active profile set; restricted entries will be skipped");

    expect(
      stripAnsi(
        formatProfileUpdateResult(
          {
            activeProfile: "work",
            action: "use",
            globalConfigPath: "/tmp/config.json",
            profile: "work",
            syncDirectory: "/tmp/sync",
            warning: "Profile 'work' is not referenced by any tracked entry.",
          },
          { verbose: true },
        ),
      ),
    ).toContain("Profile 'work' is not referenced by any tracked entry");
  });

  it("formats track, untrack, and set results", () => {
    expect(
      stripAnsi(
        formatTrackResult({
          alreadyTracked: false,
          changed: true,
          configPath: "/tmp/config.json",
          kind: "file",
          localPath: "/tmp/home/.gitconfig-work",
          profiles: [],
          mode: "secret",
          repoPath: ".gitconfig-work",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("repo      .gitconfig-work");

    expect(
      stripAnsi(
        formatTrackResult(
          {
            alreadyTracked: true,
            changed: true,
            configPath: "/tmp/config.json",
            kind: "file",
            localPath: "/tmp/home/.gitconfig",
            profiles: ["work"],
            mode: "secret",
            repoPath: ".gitconfig",
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("Updated sync target");

    expect(
      stripAnsi(
        formatTrackResult({
          alreadyTracked: true,
          changed: false,
          configPath: "/tmp/config.json",
          kind: "file",
          localPath: "/tmp/home/.gitconfig",
          profiles: [],
          mode: "normal",
          repoPath: ".gitconfig",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Sync target already tracked");

    expect(
      stripAnsi(
        formatUntrackResult(
          {
            configPath: "/tmp/config.json",
            localPath: "/tmp/home/.gitconfig",
            plainArtifactCount: 3,
            repoPath: ".gitconfig",
            secretArtifactCount: 1,
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("removed   3 plain, 1 secret");

    expect(
      stripAnsi(
        formatSetModeResult({
          action: "unchanged",
          configPath: "/tmp/config.json",
          entryRepoPath: ".config/zsh",
          localPath: "/tmp/home/.config/zsh/secrets.zsh",
          mode: "ignore",
          reason: "already-set",
          repoPath: ".config/zsh/secrets.zsh",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("detail    already ignore");

    expect(
      stripAnsi(
        formatSetModeResult({
          action: "removed",
          configPath: "/tmp/config.json",
          entryRepoPath: ".config/zsh",
          localPath: "/tmp/home/.config/zsh/secrets.zsh",
          mode: "normal",
          repoPath: ".config/zsh/secrets.zsh",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("action    removed override");

    expect(
      stripAnsi(
        formatSetModeResult({
          action: "updated",
          configPath: "/tmp/config.json",
          entryRepoPath: ".config/zsh",
          localPath: "/tmp/home/.config/zsh/secrets.zsh",
          mode: "secret",
          repoPath: ".config/zsh/secrets.zsh",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Updated sync mode");
  });

  it("formats push and pull summaries for dry-run and real execution", () => {
    expect(
      stripAnsi(
        formatPushResult(
          {
            configPath: "/tmp/config.json",
            deletedArtifactCount: 4,
            directoryCount: 2,
            dryRun: false,
            encryptedFileCount: 3,
            plainFileCount: 1,
            symlinkCount: 0,
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("removed: 4");

    expect(
      stripAnsi(
        formatPushResult({
          configPath: "/tmp/config.json",
          deletedArtifactCount: 2,
          directoryCount: 1,
          dryRun: true,
          encryptedFileCount: 0,
          plainFileCount: 1,
          symlinkCount: 0,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("would remove: 2");

    expect(
      stripAnsi(
        formatPullResult(
          {
            configPath: "/tmp/config.json",
            decryptedFileCount: 3,
            deletedLocalCount: 2,
            directoryCount: 1,
            dryRun: false,
            plainFileCount: 4,
            symlinkCount: 0,
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("Pulled from sync repository");

    expect(
      stripAnsi(
        formatPullResult({
          configPath: "/tmp/config.json",
          decryptedFileCount: 1,
          deletedLocalCount: 5,
          directoryCount: 1,
          dryRun: true,
          plainFileCount: 2,
          symlinkCount: 0,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("would remove: 5");
  });

  it("formats sync status for populated and empty entry lists", () => {
    expect(
      stripAnsi(
        formatStatusResult(
          {
            activeProfile: "work",
            configPath: "/tmp/config.json",
            entries: [
              {
                kind: "directory",
                localPath: "/tmp/home/.config/zsh",
                mode: "normal",
                profiles: [],
                repoPath: ".config/zsh",
              },
              {
                kind: "file",
                localPath: "/tmp/home/.gitconfig",
                mode: "secret",
                profiles: ["work"],
                repoPath: ".gitconfig",
              },
            ],
            entryCount: 2,
            pull: {
              configPath: "/tmp/config.json",
              decryptedFileCount: 2,
              deletedLocalCount: 1,
              directoryCount: 1,
              dryRun: false,
              plainFileCount: 3,
              preview: [],
              symlinkCount: 0,
              syncDirectory: "/tmp/sync",
            },
            push: {
              configPath: "/tmp/config.json",
              deletedArtifactCount: 1,
              directoryCount: 1,
              dryRun: false,
              encryptedFileCount: 1,
              plainFileCount: 2,
              preview: [],
              symlinkCount: 0,
              syncDirectory: "/tmp/sync",
            },
            recipientCount: 3,
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("[work]");

    expect(
      stripAnsi(
        formatStatusResult({
          configPath: "/tmp/config.json",
          entries: [],
          entryCount: 0,
          pull: {
            configPath: "/tmp/config.json",
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
            configPath: "/tmp/config.json",
            deletedArtifactCount: 0,
            directoryCount: 0,
            dryRun: true,
            encryptedFileCount: 0,
            plainFileCount: 0,
            preview: [],
            symlinkCount: 0,
            syncDirectory: "/tmp/sync",
          },
          recipientCount: 0,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("none");
  });

  it("formats doctor summaries for failure, warning, and success states", () => {
    expect(
      stripAnsi(
        formatDoctorResult(
          {
            checks: [
              {
                checkId: "git",
                detail: "Sync directory is a git repository.",
                level: "ok",
              },
              {
                checkId: "age",
                detail: "Age identity file is missing: /tmp/keys.txt.",
                level: "fail",
              },
              {
                checkId: "local-paths",
                detail: "1 tracked local path is missing.",
                level: "warn",
              },
            ],
            configPath: "/tmp/config.json",
            hasFailures: true,
            hasWarnings: true,
            syncDirectory: "/tmp/sync",
          },
          { verbose: true },
        ),
      ),
    ).toContain("Doctor found issues -- 1 ok, 1 warning, 1 failure");

    expect(
      stripAnsi(
        formatDoctorResult({
          checks: [
            {
              checkId: "entries",
              detail: "No sync entries are configured yet.",
              level: "warn",
            },
          ],
          configPath: "/tmp/config.json",
          hasFailures: false,
          hasWarnings: true,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Doctor passed -- 0 oks, 1 warning");

    expect(
      stripAnsi(
        formatDoctorResult({
          checks: [
            {
              checkId: "config",
              detail: "Loaded config with 1 entries and 1 recipients.",
              level: "ok",
            },
          ],
          configPath: "/tmp/config.json",
          hasFailures: false,
          hasWarnings: false,
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Doctor passed -- 1 ok, 0 warnings");
  });
});
