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

  it("formats track and rule updates with machine storage", () => {
    expect(
      formatSyncAddResult({
        alreadyTracked: false,
        configPath: "/tmp/config.json",
        kind: "file",
        localPath: "/tmp/home/.gitconfig-work",
        machine: "work",
        mode: "secret",
        repoPath: ".gitconfig-work",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("machines/work/.gitconfig-work");

    expect(
      formatSyncSetResult({
        action: "removed",
        configPath: "/tmp/config.json",
        entryRepoPath: ".config/zsh",
        localPath: "/tmp/home/.config/zsh/secrets.zsh",
        machine: "work",
        mode: "ignore",
        reason: "reverted-to-inherited",
        repoPath: ".config/zsh/secrets.zsh",
        scope: "exact",
        syncDirectory: "/tmp/sync",
      }),
    ).toContain("Machine: work");
  });
});
