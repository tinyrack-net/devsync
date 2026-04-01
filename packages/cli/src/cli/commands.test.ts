import type { Command } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevsyncError } from "#app/lib/error.ts";
import type { DevsyncCliContext } from "#app/services/terminal/cli-runtime.ts";

const mocked = vi.hoisted(() => ({
  assignProfiles: vi.fn(),
  clearActiveProfile: vi.fn(),
  createProgressReporter: vi.fn(),
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
  resolveConfiguredIdentityFile: vi.fn(),
  resolveConfiguredAbsolutePath: vi.fn(),
  resolveDevsyncSyncDirectory: vi.fn(),
  runDoctorChecks: vi.fn(),
  setTargetMode: vi.fn(),
  trackTarget: vi.fn(),
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

vi.mock("#app/config/identity-file.ts", () => ({
  resolveConfiguredIdentityFile: mocked.resolveConfiguredIdentityFile,
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: {},
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  pathExists: mocked.pathExists,
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
  mocked.resolveConfiguredIdentityFile.mockReturnValue("/tmp/keys.txt");
  mocked.resolveConfiguredAbsolutePath.mockReturnValue("/tmp/keys.txt");
  mocked.resolveDevsyncSyncDirectory.mockReturnValue("/tmp/devsync");
  mocked.pathExists.mockResolvedValue(true);
  mocked.promptForSecret.mockResolvedValue(undefined);
  mocked.initializeSyncDirectory.mockResolvedValue({
    alreadyInitialized: false,
    configPath: "/tmp/config.json",
    entryCount: 0,
    generatedIdentity: false,
    gitAction: "cloned",
    gitSource: "git@example.com:dotfiles.git",
    identityFile: "/tmp/keys.txt",
    recipientCount: 1,
    syncDirectory: "/tmp/devsync",
  });
  mocked.trackTarget.mockResolvedValue({
    alreadyTracked: false,
    changed: true,
    configPath: "/tmp/config.json",
    kind: "file",
    localPath: "/tmp/home/.gitconfig",
    mode: "secret",
    profiles: ["work"],
    repoPath: "profiles/work/.gitconfig",
    syncDirectory: "/tmp/devsync",
  });
  mocked.setTargetMode.mockResolvedValue({
    action: "updated",
    configPath: "/tmp/config.json",
    entryRepoPath: ".config/nvim",
    localPath: "/tmp/home/.config/nvim",
    mode: "ignore",
    repoPath: ".config/nvim",
    syncDirectory: "/tmp/devsync",
  });
  mocked.assignProfiles.mockResolvedValue(undefined);
  mocked.listProfiles.mockResolvedValue({
    activeProfile: "work",
    activeProfileMode: "single",
    assignments: [
      {
        entryLocalPath: "/tmp/home/.gitconfig",
        entryRepoPath: ".gitconfig",
        profiles: ["work"],
      },
    ],
    availableProfiles: ["personal", "work"],
    globalConfigExists: true,
    globalConfigPath: "/tmp/global-config.json",
    syncDirectory: "/tmp/devsync",
  });
  mocked.setActiveProfile.mockResolvedValue({
    action: "use",
    activeProfile: "work",
    globalConfigPath: "/tmp/global-config.json",
    profile: "work",
    syncDirectory: "/tmp/devsync",
  });
  mocked.clearActiveProfile.mockResolvedValue({
    action: "clear",
    globalConfigPath: "/tmp/global-config.json",
    syncDirectory: "/tmp/devsync",
  });
  mocked.pullChanges.mockResolvedValue({
    configPath: "/tmp/config.json",
    decryptedFileCount: 2,
    deletedLocalCount: 1,
    directoryCount: 1,
    dryRun: true,
    plainFileCount: 3,
    symlinkCount: 0,
    syncDirectory: "/tmp/devsync",
  });
  mocked.pushChanges.mockResolvedValue({
    configPath: "/tmp/config.json",
    deletedArtifactCount: 2,
    directoryCount: 1,
    dryRun: true,
    encryptedFileCount: 2,
    plainFileCount: 1,
    symlinkCount: 0,
    syncDirectory: "/tmp/devsync",
  });
  mocked.getStatus.mockResolvedValue({
    activeProfile: "work",
    configPath: "/tmp/config.json",
    entries: [
      {
        kind: "file",
        localPath: "/tmp/home/.gitconfig",
        mode: "secret",
        profiles: ["work"],
        repoPath: ".gitconfig",
      },
    ],
    entryCount: 1,
    pull: {
      configPath: "/tmp/config.json",
      decryptedFileCount: 2,
      deletedLocalCount: 1,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 3,
      preview: [".gitconfig"],
      symlinkCount: 0,
      syncDirectory: "/tmp/devsync",
    },
    push: {
      configPath: "/tmp/config.json",
      deletedArtifactCount: 2,
      directoryCount: 1,
      dryRun: true,
      encryptedFileCount: 2,
      plainFileCount: 1,
      preview: [".gitconfig"],
      symlinkCount: 0,
      syncDirectory: "/tmp/devsync",
    },
    recipientCount: 1,
    syncDirectory: "/tmp/devsync",
  });
  mocked.untrackTarget.mockResolvedValue({
    configPath: "/tmp/config.json",
    localPath: "/tmp/home/.ssh/config",
    plainArtifactCount: 3,
    repoPath: ".ssh/config",
    secretArtifactCount: 0,
    syncDirectory: "/tmp/devsync",
  });
  mocked.runDoctorChecks.mockResolvedValue({
    checks: [
      {
        checkId: "git",
        detail: "Sync directory is a git repository.",
        level: "ok",
      },
    ],
    configPath: "/tmp/config.json",
    hasFailures: false,
    hasWarnings: false,
    syncDirectory: "/tmp/devsync",
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
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Sync directory initialized"),
    );
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("config: /tmp/config.json"),
    );
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
      {
        mode: "secret",
        profile: ["work"],
        repoPath: "profiles/work/.gitconfig",
        verbose: true,
      },
      ".gitconfig",
    );

    expect(mocked.trackTarget).toHaveBeenCalledWith(
      {
        mode: "secret",
        profiles: ["work"],
        repoPath: "profiles/work/.gitconfig",
        target: ".gitconfig",
      },
      process.cwd(),
    );
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Started tracking profiles/work/.gitconfig"),
    );
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("profiles: work"),
    );
  });

  it("rejects --repo-path when tracking multiple targets", async () => {
    await expect(
      runCommand(
        trackCommand,
        {
          mode: "normal",
          repoPath: "profiles/shared/tool",
          verbose: false,
        },
        ".gitconfig",
        ".zshrc",
      ),
    ).rejects.toThrowError(
      "The --repo-path flag can only be used with a single sync target.",
    );
    expect(mocked.trackTarget).not.toHaveBeenCalled();
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
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Updated sync mode for .config/nvim"),
    );
  });

  it("lists, uses, and clears profiles", async () => {
    await runCommand(profileListCommand, { verbose: true });
    await runCommand(profileUseCommand, { verbose: false }, "work");
    await runCommand(profileUseCommand, { verbose: true });

    expect(mocked.listProfiles).toHaveBeenCalledTimes(1);
    expect(mocked.setActiveProfile).toHaveBeenCalledWith("work");
    expect(mocked.clearActiveProfile).toHaveBeenCalledTimes(1);
    expect(mocked.print).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("available: personal, work"),
    );
    expect(mocked.print).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("Active profile set to work"),
    );
    expect(mocked.print).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("Active profile cleared"),
    );
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
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Dry run: pull preview"),
    );
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Dry run: push preview"),
    );
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Sync status"),
    );
  });

  it("untracks tracked targets relative to the current working directory", async () => {
    await runCommand(untrackCommand, { verbose: true }, ".ssh/config");

    expect(mocked.untrackTarget).toHaveBeenCalledWith(
      {
        target: ".ssh/config",
      },
      process.cwd(),
    );
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Stopped tracking .ssh/config"),
    );
  });

  it("marks doctor failures through process.exitCode", async () => {
    mocked.runDoctorChecks.mockResolvedValue({
      checks: [
        {
          checkId: "age",
          detail: "Age identity file is missing: /tmp/keys.txt.",
          level: "fail",
        },
      ],
      configPath: "/tmp/config.json",
      hasFailures: true,
      hasWarnings: false,
      syncDirectory: "/tmp/devsync",
    });

    await runCommand(doctorCommand, { verbose: true });

    expect(mocked.runDoctorChecks).toHaveBeenCalledWith(progressReporter);
    expect(mocked.print).toHaveBeenCalledWith(
      expect.stringContaining("Doctor found issues"),
    );
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
