import { describe, expect, it } from "vitest";

import {
  formatSyncAddResult,
  formatSyncProfileListResult,
  formatSyncProfileUpdateResult,
  formatSyncSetResult,
} from "./output.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
const ansiPattern = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replaceAll(ansiPattern, "");

describe("output", () => {
  it("formats profile list and update results", () => {
    expect(
      stripAnsi(
        formatSyncProfileListResult({
          activeProfile: "work",
          activeProfilesMode: "single",
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
        formatSyncProfileUpdateResult({
          activeProfile: "work",
          globalConfigPath: "/tmp/config.json",
          profile: "work",
          mode: "use",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Updated active profile to work");

    expect(
      stripAnsi(
        formatSyncProfileUpdateResult({
          globalConfigPath: "/tmp/config.json",
          mode: "clear",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Cleared active profile");
  });

  it("formats track and set results", () => {
    expect(
      stripAnsi(
        formatSyncAddResult({
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
        formatSyncSetResult({
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
  });
});
