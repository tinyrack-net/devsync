import { describe, expect, it } from "vitest";

import {
  formatSyncAddResult,
  formatSyncMachineListResult,
  formatSyncMachineUpdateResult,
  formatSyncSetResult,
} from "./output.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
const ansiPattern = /\x1b\[[0-9;]*m/g;
const stripAnsi = (value: string) => value.replaceAll(ansiPattern, "");

describe("output", () => {
  it("formats machine list and update results", () => {
    expect(
      stripAnsi(
        formatSyncMachineListResult({
          activeMachine: "work",
          activeMachinesMode: "single",
          assignments: [],
          availableMachines: ["personal", "work"],
          globalConfigExists: true,
          globalConfigPath: "/tmp/config.json",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Machines: 2 paths");

    expect(
      stripAnsi(
        formatSyncMachineUpdateResult({
          activeMachine: "work",
          globalConfigPath: "/tmp/config.json",
          machine: "work",
          mode: "use",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Updated active sync machine.");

    expect(
      stripAnsi(
        formatSyncMachineUpdateResult({
          globalConfigPath: "/tmp/config.json",
          mode: "clear",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("Cleared active sync machine.");
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
          machines: [],
          mode: "secret",
          repoPath: ".gitconfig-work",
          syncDirectory: "/tmp/sync",
        }),
      ),
    ).toContain("default/.gitconfig-work");

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
    ).toContain("already has ignore mode");
  });
});
