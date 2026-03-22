import { describe, expect, it } from "vitest";

import {
  formatSyncAddResult,
  formatSyncMachineListResult,
  formatSyncMachineUpdateResult,
  formatSyncSetResult,
} from "./output.ts";

describe("output", () => {
  it("formats machine list and update results", () => {
    expect(
      formatSyncMachineListResult({
        activeMachine: "work",
        activeMachinesMode: "single",
        assignments: [],
        availableMachines: ["personal", "work"],
        globalConfigExists: true,
        globalConfigPath: "/tmp/config.json",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Machines: 2 paths");

    expect(
      formatSyncMachineUpdateResult({
        activeMachine: "work",
        globalConfigPath: "/tmp/config.json",
        machine: "work",
        mode: "use",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Updated active sync machine.");

    expect(
      formatSyncMachineUpdateResult({
        globalConfigPath: "/tmp/config.json",
        mode: "clear",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Cleared active sync machine.");
  });

  it("formats track and set results", () => {
    expect(
      formatSyncAddResult({
        alreadyTracked: false,
        configPath: "/tmp/config.json",
        kind: "file",
        localPath: "/tmp/home/.gitconfig-work",
        machines: [],
        mode: "secret",
        repoPath: ".gitconfig-work",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("default/.gitconfig-work");

    expect(
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
    ).toContain("already has ignore mode");
  });
});
