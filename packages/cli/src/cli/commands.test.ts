import type { Command } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevsyncError } from "#app/lib/error.ts";
import type { DevsyncCliContext } from "#app/services/terminal/cli-runtime.ts";

const mocked = vi.hoisted(() => ({
  assignProfiles: vi.fn(),
  clearActiveProfile: vi.fn(),
  createProgressReporter: vi.fn(),
  formatTrackResult: vi.fn(),
  formatDoctorResult: vi.fn(),
  formatInitResult: vi.fn(),
  formatProfileListResult: vi.fn(),
  formatProfileUpdateResult: vi.fn(),
  formatPullResult: vi.fn(),
  formatPushResult: vi.fn(),
  formatSetModeResult: vi.fn(),
  formatStatusResult: vi.fn(),
  getStatus: vi.fn(),
  initializeSyncDirectory: vi.fn(),
  launchShellInDirectory: vi.fn(),
  listProfiles: vi.fn(),
  mkdir: vi.fn(),
  pathExists: vi.fn(),
  print: vi.fn(),
  promptForSecret: vi.fn(),
  pullChanges: vi.fn(),
  pushChanges: vi.fn(),
  resolveConfiguredAbsolutePath: vi.fn(),
  resolveDevsyncSyncDirectory: vi.fn(),
  runDoctorChecks: vi.fn(),
  setTargetMode: vi.fn(),
  trackTarget: vi.fn(),
  formatUntrackResult: vi.fn(),
  untrackTarget: vi.fn(),
  setActiveProfile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocked.mkdir,
}));

vi.mock("#app/config/xdg.ts", () => ({
  resolveConfiguredAbsolutePath: mocked.resolveConfiguredAbsolutePath,
  resolveDevsyncSyncDirectory: mocked.resolveDevsyncSyncDirectory,
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: {},
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  pathExists: mocked.pathExists,
}));

vi.mock("#app/lib/output.ts", () => ({
  formatTrackResult: mocked.formatTrackResult,
  formatDoctorResult: mocked.formatDoctorResult,
  formatInitResult: mocked.formatInitResult,
  formatProfileListResult: mocked.formatProfileListResult,
  formatProfileUpdateResult: mocked.formatProfileUpdateResult,
  formatPullResult: mocked.formatPullResult,
  formatPushResult: mocked.formatPushResult,
  formatSetModeResult: mocked.formatSetModeResult,
  formatStatusResult: mocked.formatStatusResult,
  formatUntrackResult: mocked.formatUntrackResult,
}));

vi.mock("#app/services/track.ts", () => ({
  trackTarget: mocked.trackTarget,
}));

vi.mock("#app/services/doctor.ts", () => ({
  runDoctorChecks: mocked.runDoctorChecks,
}));

vi.mock("#app/services/untrack.ts", () => ({
  untrackTarget: mocked.untrackTarget,
}));

vi.mock("#app/services/init.ts", () => ({
  defaultSyncIdentityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
  initializeSyncDirectory: mocked.initializeSyncDirectory,
}));

vi.mock("#app/services/profile.ts", () => ({
  assignProfiles: mocked.assignProfiles,
  clearActiveProfile: mocked.clearActiveProfile,
  listProfiles: mocked.listProfiles,
  setActiveProfile: mocked.setActiveProfile,
}));

vi.mock("#app/services/pull.ts", () => ({
  pullChanges: mocked.pullChanges,
}));

vi.mock("#app/services/push.ts", () => ({
  pushChanges: mocked.pushChanges,
}));

vi.mock("#app/services/set.ts", () => ({
  setTargetMode: mocked.setTargetMode,
}));

vi.mock("#app/services/status.ts", () => ({
  getStatus: mocked.getStatus,
}));

vi.mock("#app/services/terminal/cli-runtime.ts", () => ({
  createProgressReporter: mocked.createProgressReporter,
  isVerbose: (value?: boolean) => value ?? false,
  print: mocked.print,
  verboseFlag: {
    brief: "verbose",
    kind: "boolean",
    optional: true,
  },
}));

vi.mock("#app/services/terminal/prompt.ts", () => ({
  promptForSecret: mocked.promptForSecret,
}));

vi.mock("#app/services/terminal/shell.ts", () => ({
  launchShellInDirectory: mocked.launchShellInDirectory,
}));

import cdCommand from "./cd.ts";
import doctorCommand from "./doctor.ts";
import initCommand from "./init.ts";
import profileListCommand from "./profile/list.ts";
import profileUseCommand from "./profile/use.ts";
import pullCommand from "./pull.ts";
import pushCommand from "./push.ts";
import statusCommand from "./status.ts";
import trackCommand from "./track.ts";
import untrackCommand from "./untrack.ts";

const progressReporter = {
  detail: vi.fn(),
  phase: vi.fn(),
  verbose: false,
};

const runCommand = async (
  command: Command<DevsyncCliContext>,
  flags: Record<string, unknown>,
  ...args: string[]
) => {
  const loaded = (await command.loader()) as
    | ((flags: Record<string, unknown>, ...args: string[]) => Promise<void>)
    | {
        default?: (
          flags: Record<string, unknown>,
          ...args: string[]
        ) => Promise<void>;
        func?: (
          flags: Record<string, unknown>,
          ...args: string[]
        ) => Promise<void>;
      };
  const func =
    typeof loaded === "function" ? loaded : (loaded.default ?? loaded.func);

  await func?.call({} as never, flags, ...args);
};

beforeEach(() => {
  process.exitCode = undefined;
  vi.clearAllMocks();

  progressReporter.detail.mockReset();
  progressReporter.phase.mockReset();
  progressReporter.verbose = false;

  mocked.createProgressReporter.mockReturnValue(progressReporter);
  mocked.formatTrackResult.mockReturnValue("track output");
  mocked.formatDoctorResult.mockReturnValue("doctor output");
  mocked.formatUntrackResult.mockReturnValue("untrack output");
  mocked.formatInitResult.mockReturnValue("init output");
  mocked.formatProfileListResult.mockReturnValue("profile list output");
  mocked.formatProfileUpdateResult.mockReturnValue("profile update output");
  mocked.formatPullResult.mockReturnValue("pull output");
  mocked.formatPushResult.mockReturnValue("push output");
  mocked.formatSetModeResult.mockReturnValue("set output");
  mocked.formatStatusResult.mockReturnValue("status output");
  mocked.resolveConfiguredAbsolutePath.mockReturnValue("/tmp/keys.txt");
  mocked.resolveDevsyncSyncDirectory.mockReturnValue("/tmp/devsync");
  mocked.pathExists.mockResolvedValue(true);
  mocked.promptForSecret.mockResolvedValue(undefined);
  mocked.initializeSyncDirectory.mockResolvedValue({ step: "init" });
  mocked.trackTarget.mockResolvedValue({ step: "track" });
  mocked.setTargetMode.mockResolvedValue({ step: "set" });
  mocked.assignProfiles.mockResolvedValue(undefined);
  mocked.listProfiles.mockResolvedValue({ step: "list" });
  mocked.setActiveProfile.mockResolvedValue({ step: "use" });
  mocked.clearActiveProfile.mockResolvedValue({ step: "clear" });
  mocked.pullChanges.mockResolvedValue({ step: "pull" });
  mocked.pushChanges.mockResolvedValue({ step: "push" });
  mocked.getStatus.mockResolvedValue({ step: "status" });
  mocked.untrackTarget.mockResolvedValue({ step: "untrack" });
  mocked.runDoctorChecks.mockResolvedValue({
    hasFailures: false,
    step: "doctor",
  });
  mocked.mkdir.mockResolvedValue(undefined);
  mocked.launchShellInDirectory.mockResolvedValue(undefined);
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("CLI command modules", () => {
  it("initializes with an explicit key without prompting", async () => {
    await runCommand(
      initCommand,
      {
        identity: "~/keys.txt",
        key: "  AGE-SECRET-KEY-123  ",
        recipient: ["age1recipient"],
        verbose: true,
      },
      "git@example.com:dotfiles.git",
    );

    expect(mocked.promptForSecret).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith(
      {
        ageIdentity: "AGE-SECRET-KEY-123",
        generateAgeIdentity: false,
        identityFile: "~/keys.txt",
        recipients: ["age1recipient"],
        repository: "git@example.com:dotfiles.git",
      },
      progressReporter,
    );
    expect(mocked.formatInitResult).toHaveBeenCalledWith(
      { step: "init" },
      { verbose: true },
    );
    expect(mocked.print).toHaveBeenCalledWith("init output");
  });

  it("prompts for a key and requests generation when the prompt is blank", async () => {
    mocked.pathExists.mockResolvedValue(false);
    mocked.promptForSecret.mockResolvedValue("   ");

    await runCommand(initCommand, {}, "origin");

    expect(mocked.promptForSecret).toHaveBeenCalledWith(
      "Enter an age private key (leave empty to generate a new one): ",
    );
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith(
      {
        ageIdentity: undefined,
        generateAgeIdentity: true,
        identityFile: undefined,
        recipients: [],
        repository: "origin",
      },
      progressReporter,
    );
  });

  it("tracks new targets and formats track output", async () => {
    await runCommand(
      trackCommand,
      { mode: "secret", profile: ["work"], verbose: true },
      ".gitconfig",
    );

    expect(mocked.trackTarget).toHaveBeenCalledWith(
      {
        mode: "secret",
        profiles: ["work"],
        target: ".gitconfig",
      },
      process.cwd(),
    );
    expect(mocked.formatTrackResult).toHaveBeenCalledWith(
      { step: "track" },
      { verbose: true },
    );
    expect(mocked.print).toHaveBeenCalledWith("track output");
  });

  it("falls back to mode updates when tracking finds an existing target", async () => {
    mocked.trackTarget.mockRejectedValue(
      new DevsyncError("existing target", {
        code: "TARGET_NOT_FOUND",
      }),
    );

    await runCommand(
      trackCommand,
      { mode: "ignore", profile: [""], verbose: false },
      ".config/nvim",
    );

    expect(mocked.setTargetMode).toHaveBeenCalledWith(
      {
        mode: "ignore",
        target: ".config/nvim",
      },
      process.cwd(),
    );
    expect(mocked.assignProfiles).toHaveBeenCalledWith(
      {
        profiles: [],
        target: ".config/nvim",
      },
      process.cwd(),
    );
    expect(mocked.formatSetModeResult).toHaveBeenCalledWith(
      { step: "set" },
      { verbose: false },
    );
    expect(mocked.print).toHaveBeenCalledWith("set output");
  });

  it("lists, uses, and clears profiles", async () => {
    await runCommand(profileListCommand, { verbose: true });
    await runCommand(profileUseCommand, { verbose: false }, "work");
    await runCommand(profileUseCommand, { verbose: true });

    expect(mocked.listProfiles).toHaveBeenCalledTimes(1);
    expect(mocked.setActiveProfile).toHaveBeenCalledWith("work");
    expect(mocked.clearActiveProfile).toHaveBeenCalledTimes(1);
    expect(mocked.print).toHaveBeenNthCalledWith(1, "profile list output");
    expect(mocked.print).toHaveBeenNthCalledWith(2, "profile update output");
    expect(mocked.print).toHaveBeenNthCalledWith(3, "profile update output");
  });

  it("passes pull, push, and status flags through with a shared reporter", async () => {
    await runCommand(pullCommand, {
      dryRun: true,
      profile: "work",
      verbose: true,
    });
    await runCommand(pushCommand, {
      dryRun: true,
      profile: "work",
      verbose: false,
    });
    await runCommand(statusCommand, { profile: "work", verbose: true });

    expect(mocked.pullChanges).toHaveBeenCalledWith(
      {
        dryRun: true,
        profile: "work",
      },
      progressReporter,
    );
    expect(mocked.pushChanges).toHaveBeenCalledWith(
      {
        dryRun: true,
        profile: "work",
      },
      progressReporter,
    );
    expect(mocked.getStatus).toHaveBeenCalledWith({
      profile: "work",
      reporter: progressReporter,
    });
    expect(mocked.print).toHaveBeenCalledWith("pull output");
    expect(mocked.print).toHaveBeenCalledWith("push output");
    expect(mocked.print).toHaveBeenCalledWith("status output");
  });

  it("untracks tracked targets relative to the current working directory", async () => {
    await runCommand(untrackCommand, { verbose: true }, ".ssh/config");

    expect(mocked.untrackTarget).toHaveBeenCalledWith(
      {
        target: ".ssh/config",
      },
      process.cwd(),
    );
    expect(mocked.formatUntrackResult).toHaveBeenCalledWith(
      { step: "untrack" },
      { verbose: true },
    );
    expect(mocked.print).toHaveBeenCalledWith("untrack output");
  });

  it("marks doctor failures through process.exitCode", async () => {
    mocked.runDoctorChecks.mockResolvedValue({
      hasFailures: true,
      step: "doctor",
    });

    await runCommand(doctorCommand, { verbose: true });

    expect(mocked.runDoctorChecks).toHaveBeenCalledWith(progressReporter);
    expect(mocked.formatDoctorResult).toHaveBeenCalledWith(
      { hasFailures: true, step: "doctor" },
      { verbose: true },
    );
    expect(mocked.print).toHaveBeenCalledWith("doctor output");
    expect(process.exitCode).toBe(1);
  });

  it("creates the sync directory before launching cd shells", async () => {
    await runCommand(cdCommand, { verbose: false });

    expect(mocked.resolveDevsyncSyncDirectory).toHaveBeenCalledTimes(1);
    expect(mocked.mkdir).toHaveBeenCalledWith("/tmp/devsync", {
      recursive: true,
    });
    expect(mocked.launchShellInDirectory).toHaveBeenCalledWith("/tmp/devsync");
  });
});
