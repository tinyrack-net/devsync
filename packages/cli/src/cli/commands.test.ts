import type { Command } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevsyncError } from "#app/lib/error.ts";
import type { DevsyncCliContext } from "#app/services/terminal/cli-runtime.ts";

const mocked = vi.hoisted(() => ({
  assignSyncProfiles: vi.fn(),
  clearSyncProfiles: vi.fn(),
  createProgressReporter: vi.fn(),
  forgetSyncTarget: vi.fn(),
  formatSyncAddResult: vi.fn(),
  formatSyncDoctorResult: vi.fn(),
  formatSyncForgetResult: vi.fn(),
  formatSyncInitResult: vi.fn(),
  formatSyncProfileListResult: vi.fn(),
  formatSyncProfileUpdateResult: vi.fn(),
  formatSyncPullResult: vi.fn(),
  formatSyncPushResult: vi.fn(),
  formatSyncSetResult: vi.fn(),
  formatSyncStatusResult: vi.fn(),
  getSyncStatus: vi.fn(),
  initializeSync: vi.fn(),
  launchShellInDirectory: vi.fn(),
  listSyncProfiles: vi.fn(),
  mkdir: vi.fn(),
  pathExists: vi.fn(),
  print: vi.fn(),
  promptForSecret: vi.fn(),
  pullSync: vi.fn(),
  pushSync: vi.fn(),
  resolveConfiguredAbsolutePath: vi.fn(),
  resolveDevsyncSyncDirectory: vi.fn(),
  runDoctor: vi.fn(),
  setSyncTargetMode: vi.fn(),
  trackSyncTarget: vi.fn(),
  useSyncProfile: vi.fn(),
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
  formatSyncAddResult: mocked.formatSyncAddResult,
  formatSyncDoctorResult: mocked.formatSyncDoctorResult,
  formatSyncForgetResult: mocked.formatSyncForgetResult,
  formatSyncInitResult: mocked.formatSyncInitResult,
  formatSyncProfileListResult: mocked.formatSyncProfileListResult,
  formatSyncProfileUpdateResult: mocked.formatSyncProfileUpdateResult,
  formatSyncPullResult: mocked.formatSyncPullResult,
  formatSyncPushResult: mocked.formatSyncPushResult,
  formatSyncSetResult: mocked.formatSyncSetResult,
  formatSyncStatusResult: mocked.formatSyncStatusResult,
}));

vi.mock("#app/services/add.ts", () => ({
  trackSyncTarget: mocked.trackSyncTarget,
}));

vi.mock("#app/services/doctor.ts", () => ({
  runDoctor: mocked.runDoctor,
}));

vi.mock("#app/services/forget.ts", () => ({
  forgetSyncTarget: mocked.forgetSyncTarget,
}));

vi.mock("#app/services/init.ts", () => ({
  defaultSyncIdentityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
  initializeSync: mocked.initializeSync,
}));

vi.mock("#app/services/profile.ts", () => ({
  assignSyncProfiles: mocked.assignSyncProfiles,
  clearSyncProfiles: mocked.clearSyncProfiles,
  listSyncProfiles: mocked.listSyncProfiles,
  useSyncProfile: mocked.useSyncProfile,
}));

vi.mock("#app/services/pull.ts", () => ({
  pullSync: mocked.pullSync,
}));

vi.mock("#app/services/push.ts", () => ({
  pushSync: mocked.pushSync,
}));

vi.mock("#app/services/set.ts", () => ({
  setSyncTargetMode: mocked.setSyncTargetMode,
}));

vi.mock("#app/services/status.ts", () => ({
  getSyncStatus: mocked.getSyncStatus,
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
  mocked.formatSyncAddResult.mockReturnValue("track output");
  mocked.formatSyncDoctorResult.mockReturnValue("doctor output");
  mocked.formatSyncForgetResult.mockReturnValue("forget output");
  mocked.formatSyncInitResult.mockReturnValue("init output");
  mocked.formatSyncProfileListResult.mockReturnValue("profile list output");
  mocked.formatSyncProfileUpdateResult.mockReturnValue("profile update output");
  mocked.formatSyncPullResult.mockReturnValue("pull output");
  mocked.formatSyncPushResult.mockReturnValue("push output");
  mocked.formatSyncSetResult.mockReturnValue("set output");
  mocked.formatSyncStatusResult.mockReturnValue("status output");
  mocked.resolveConfiguredAbsolutePath.mockReturnValue("/tmp/keys.txt");
  mocked.resolveDevsyncSyncDirectory.mockReturnValue("/tmp/devsync");
  mocked.pathExists.mockResolvedValue(true);
  mocked.promptForSecret.mockResolvedValue(undefined);
  mocked.initializeSync.mockResolvedValue({ step: "init" });
  mocked.trackSyncTarget.mockResolvedValue({ step: "track" });
  mocked.setSyncTargetMode.mockResolvedValue({ step: "set" });
  mocked.assignSyncProfiles.mockResolvedValue(undefined);
  mocked.listSyncProfiles.mockResolvedValue({ step: "list" });
  mocked.useSyncProfile.mockResolvedValue({ step: "use" });
  mocked.clearSyncProfiles.mockResolvedValue({ step: "clear" });
  mocked.pullSync.mockResolvedValue({ step: "pull" });
  mocked.pushSync.mockResolvedValue({ step: "push" });
  mocked.getSyncStatus.mockResolvedValue({ step: "status" });
  mocked.forgetSyncTarget.mockResolvedValue({ step: "forget" });
  mocked.runDoctor.mockResolvedValue({ hasFailures: false, step: "doctor" });
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
    expect(mocked.initializeSync).toHaveBeenCalledWith(
      {
        ageIdentity: "AGE-SECRET-KEY-123",
        generateAgeIdentity: false,
        identityFile: "~/keys.txt",
        recipients: ["age1recipient"],
        repository: "git@example.com:dotfiles.git",
      },
      progressReporter,
    );
    expect(mocked.formatSyncInitResult).toHaveBeenCalledWith(
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
    expect(mocked.initializeSync).toHaveBeenCalledWith(
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

  it("tracks new targets and formats add output", async () => {
    await runCommand(
      trackCommand,
      { mode: "secret", profile: ["work"], verbose: true },
      ".gitconfig",
    );

    expect(mocked.trackSyncTarget).toHaveBeenCalledWith(
      {
        mode: "secret",
        profiles: ["work"],
        target: ".gitconfig",
      },
      process.cwd(),
    );
    expect(mocked.formatSyncAddResult).toHaveBeenCalledWith(
      { step: "track" },
      { verbose: true },
    );
    expect(mocked.print).toHaveBeenCalledWith("track output");
  });

  it("falls back to mode updates when tracking finds an existing target", async () => {
    mocked.trackSyncTarget.mockRejectedValue(
      new DevsyncError("existing target", {
        code: "TARGET_NOT_FOUND",
      }),
    );

    await runCommand(
      trackCommand,
      { mode: "ignore", profile: [""], verbose: false },
      ".config/nvim",
    );

    expect(mocked.setSyncTargetMode).toHaveBeenCalledWith(
      {
        mode: "ignore",
        target: ".config/nvim",
      },
      process.cwd(),
    );
    expect(mocked.assignSyncProfiles).toHaveBeenCalledWith(
      {
        profiles: [],
        target: ".config/nvim",
      },
      process.cwd(),
    );
    expect(mocked.formatSyncSetResult).toHaveBeenCalledWith(
      { step: "set" },
      { verbose: false },
    );
    expect(mocked.print).toHaveBeenCalledWith("set output");
  });

  it("lists, uses, and clears profiles", async () => {
    await runCommand(profileListCommand, { verbose: true });
    await runCommand(profileUseCommand, { verbose: false }, "work");
    await runCommand(profileUseCommand, { verbose: true });

    expect(mocked.listSyncProfiles).toHaveBeenCalledTimes(1);
    expect(mocked.useSyncProfile).toHaveBeenCalledWith("work");
    expect(mocked.clearSyncProfiles).toHaveBeenCalledTimes(1);
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

    expect(mocked.pullSync).toHaveBeenCalledWith(
      {
        dryRun: true,
        profile: "work",
      },
      progressReporter,
    );
    expect(mocked.pushSync).toHaveBeenCalledWith(
      {
        dryRun: true,
        profile: "work",
      },
      progressReporter,
    );
    expect(mocked.getSyncStatus).toHaveBeenCalledWith({
      profile: "work",
      reporter: progressReporter,
    });
    expect(mocked.print).toHaveBeenCalledWith("pull output");
    expect(mocked.print).toHaveBeenCalledWith("push output");
    expect(mocked.print).toHaveBeenCalledWith("status output");
  });

  it("forgets tracked targets relative to the current working directory", async () => {
    await runCommand(untrackCommand, { verbose: true }, ".ssh/config");

    expect(mocked.forgetSyncTarget).toHaveBeenCalledWith(
      {
        target: ".ssh/config",
      },
      process.cwd(),
    );
    expect(mocked.formatSyncForgetResult).toHaveBeenCalledWith(
      { step: "forget" },
      { verbose: true },
    );
    expect(mocked.print).toHaveBeenCalledWith("forget output");
  });

  it("marks doctor failures through process.exitCode", async () => {
    mocked.runDoctor.mockResolvedValue({
      hasFailures: true,
      step: "doctor",
    });

    await runCommand(doctorCommand, { verbose: true });

    expect(mocked.runDoctor).toHaveBeenCalledWith(progressReporter);
    expect(mocked.formatSyncDoctorResult).toHaveBeenCalledWith(
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
