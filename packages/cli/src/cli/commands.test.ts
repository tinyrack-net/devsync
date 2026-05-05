import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Command } from "@stricli/core";
import { DotweaveError } from "#app/lib/error.ts";
import type { DotweaveCliContext } from "#app/services/terminal/cli-runtime.ts";

type MockFn = ReturnType<typeof mock>;

mock.module("node:fs/promises", () => ({
  mkdir: mock(),
}));

mock.module("#app/config/xdg.ts", () => ({
  resolveConfiguredAbsolutePath: mock(),
  resolveDotweaveConfigDirectory: mock(),
}));

mock.module("#app/config/runtime-env.ts", () => ({
  readEnvValue: mock(),
  resolveDotweaveSyncDirectoryFromEnv: mock(),
}));

mock.module("#app/config/identity-file.ts", () => ({
  resolveDefaultIdentityFile: mock(),
}));

mock.module("#app/lib/env.ts", () => ({
  ENV: {},
}));

mock.module("#app/lib/filesystem.ts", () => ({
  pathExists: mock(),
}));

mock.module("#app/services/track.ts", () => ({
  trackTarget: mock(),
}));

mock.module("#app/services/doctor.ts", () => ({
  runDoctorChecks: mock(),
}));

mock.module("#app/services/untrack.ts", () => ({
  untrackTarget: mock(),
}));

mock.module("#app/services/init.ts", () => ({
  createMissingRepositoryAgeKeyError: mock(),
  initializeSyncDirectory: mock(),
}));

mock.module("#app/services/profile.ts", () => ({
  assignProfiles: mock(),
  clearActiveProfile: mock(),
  listProfiles: mock(),
  setActiveProfile: mock(),
}));

mock.module("#app/services/pull.ts", () => ({
  applyPullPlan: mock(),
  buildPullResultFromPlan: mock(),
  preparePull: mock(),
}));

mock.module("#app/services/push.ts", () => ({
  pushChanges: mock(),
}));

mock.module("#app/services/set.ts", () => ({
  setTargetMode: mock(),
}));

mock.module("#app/services/status.ts", () => ({
  getStatus: mock(),
}));

mock.module("consola", () => ({
  default: {
    prompt: mock(),
  },
}));

mock.module("#app/services/terminal/cli-runtime.ts", () => ({
  verboseFlag: {
    brief: "verbose",
    kind: "boolean",
    optional: true,
  },
}));

mock.module("#app/services/terminal/logger.ts", () => {
  const logger = {
    fail: mock(),
    info: mock(),
    level: 3,
    log: mock(),
    start: mock(),
    success: mock(),
    verbose: mock(),
    warn: mock(),
  };
  return {
    createCliLogger: mock(() => logger),
  };
});

mock.module("#app/services/terminal/shell.ts", () => ({
  launchShellInDirectory: mock(),
}));

import * as mockedFs from "node:fs/promises";
import * as mockedConsola from "consola";
import * as mockedIdentityFile from "#app/config/identity-file.ts";
import * as mockedRuntimeEnv from "#app/config/runtime-env.ts";
import * as mockedXdg from "#app/config/xdg.ts";
import * as mockedFilesystem from "#app/lib/filesystem.ts";
import * as mockedDoctor from "#app/services/doctor.ts";
import * as mockedInit from "#app/services/init.ts";
import * as mockedProfile from "#app/services/profile.ts";
import * as mockedPull from "#app/services/pull.ts";
import * as mockedPush from "#app/services/push.ts";
import * as mockedSet from "#app/services/set.ts";
import * as mockedStatus from "#app/services/status.ts";
import * as mockedLogger from "#app/services/terminal/logger.ts";
import * as mockedShell from "#app/services/terminal/shell.ts";
import * as mockedTrack from "#app/services/track.ts";
import * as mockedUntrack from "#app/services/untrack.ts";

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

const mockLogger = (mockedLogger.createCliLogger as MockFn)();

const mocked = {
  mkdir: mockedFs.mkdir as MockFn,
  resolveConfiguredAbsolutePath:
    mockedXdg.resolveConfiguredAbsolutePath as MockFn,
  resolveDotweaveConfigDirectory:
    mockedXdg.resolveDotweaveConfigDirectory as MockFn,
  readEnvValue: mockedRuntimeEnv.readEnvValue as MockFn,
  resolveDotweaveSyncDirectory:
    mockedRuntimeEnv.resolveDotweaveSyncDirectoryFromEnv as MockFn,
  resolveDefaultIdentityFile:
    mockedIdentityFile.resolveDefaultIdentityFile as MockFn,
  pathExists: mockedFilesystem.pathExists as MockFn,
  trackTarget: mockedTrack.trackTarget as MockFn,
  runDoctorChecks: mockedDoctor.runDoctorChecks as MockFn,
  untrackTarget: mockedUntrack.untrackTarget as MockFn,
  createMissingRepositoryAgeKeyError:
    mockedInit.createMissingRepositoryAgeKeyError as MockFn,
  initializeSyncDirectory: mockedInit.initializeSyncDirectory as MockFn,
  assignProfiles: mockedProfile.assignProfiles as MockFn,
  clearActiveProfile: mockedProfile.clearActiveProfile as MockFn,
  listProfiles: mockedProfile.listProfiles as MockFn,
  setActiveProfile: mockedProfile.setActiveProfile as MockFn,
  applyPullPlan: mockedPull.applyPullPlan as MockFn,
  buildPullResultFromPlan: mockedPull.buildPullResultFromPlan as MockFn,
  preparePull: mockedPull.preparePull as MockFn,
  pushChanges: mockedPush.pushChanges as MockFn,
  setTargetMode: mockedSet.setTargetMode as MockFn,
  getStatus: mockedStatus.getStatus as MockFn,
  consolaPrompt: (mockedConsola as unknown as { default: { prompt: MockFn } })
    .default.prompt,
  launchShellInDirectory: mockedShell.launchShellInDirectory as MockFn,
};

const runCommand = async (
  command: Command<DotweaveCliContext>,
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
  mock.clearAllMocks();

  mocked.resolveDefaultIdentityFile.mockReturnValue("/tmp/keys.txt");
  mocked.resolveConfiguredAbsolutePath.mockReturnValue("/tmp/keys.txt");
  mocked.resolveDotweaveSyncDirectory.mockReturnValue("/tmp/dotweave");
  mocked.pathExists.mockResolvedValue(true);
  mocked.consolaPrompt.mockResolvedValue(undefined);
  mocked.createMissingRepositoryAgeKeyError.mockImplementation(() => {
    return new DotweaveError(
      "Existing repository setup requires an age private key.",
    );
  });
  mocked.initializeSyncDirectory.mockResolvedValue({
    alreadyInitialized: false,
    configPath: "/tmp/config.json",
    entryCount: 0,
    generatedIdentity: false,
    gitAction: "cloned",
    gitSource: "git@example.com:dotfiles.git",
    identityFile: "/tmp/keys.txt",
    recipientCount: 1,
    syncDirectory: "/tmp/dotweave",
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
    syncDirectory: "/tmp/dotweave",
  });
  mocked.setTargetMode.mockResolvedValue({
    action: "updated",
    configPath: "/tmp/config.json",
    entryRepoPath: ".config/nvim",
    localPath: "/tmp/home/.config/nvim",
    mode: "ignore",
    repoPath: ".config/nvim",
    syncDirectory: "/tmp/dotweave",
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
    syncDirectory: "/tmp/dotweave",
  });
  mocked.setActiveProfile.mockResolvedValue({
    action: "use",
    activeProfile: "work",
    globalConfigPath: "/tmp/global-config.json",
    profile: "work",
    syncDirectory: "/tmp/dotweave",
  });
  mocked.clearActiveProfile.mockResolvedValue({
    action: "clear",
    globalConfigPath: "/tmp/global-config.json",
    syncDirectory: "/tmp/dotweave",
  });
  mocked.preparePull.mockResolvedValue({
    config: {
      entries: [],
      version: 7,
    },
    plan: {
      counts: {
        decryptedFileCount: 2,
        directoryCount: 1,
        plainFileCount: 3,
        symlinkCount: 0,
      },
      deletedLocalCount: 1,
      deletedLocalPaths: ["/tmp/home/.config/app/obsolete.txt"],
      desiredKeys: new Set([".config/app/config.toml"]),
      existingKeys: new Set(["obsolete-a"]),
      materializations: [],
      updatedLocalPaths: ["/tmp/home/.config/app/config.toml"],
    },
    syncDirectory: "/tmp/dotweave",
  });
  mocked.applyPullPlan.mockResolvedValue(undefined);
  mocked.buildPullResultFromPlan.mockReturnValue({
    configPath: "/tmp/config.json",
    decryptedFileCount: 2,
    deletedLocalCount: 1,
    directoryCount: 1,
    dryRun: true,
    plainFileCount: 3,
    symlinkCount: 0,
    syncDirectory: "/tmp/dotweave",
  });
  mocked.pushChanges.mockResolvedValue({
    configPath: "/tmp/config.json",
    deletedArtifactCount: 2,
    directoryCount: 1,
    dryRun: true,
    encryptedFileCount: 2,
    plainFileCount: 1,
    symlinkCount: 0,
    syncDirectory: "/tmp/dotweave",
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
      changes: {
        updated: ["/tmp/home/.gitconfig"],
        deleted: [],
      },
      configPath: "/tmp/config.json",
      decryptedFileCount: 2,
      deletedLocalCount: 1,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 3,
      preview: [".gitconfig"],
      symlinkCount: 0,
      syncDirectory: "/tmp/dotweave",
    },
    push: {
      changes: {
        added: [".gitconfig"],
        modified: [],
        deleted: [".oldconfig"],
      },
      configPath: "/tmp/config.json",
      deletedArtifactCount: 2,
      directoryCount: 1,
      dryRun: true,
      encryptedFileCount: 2,
      plainFileCount: 1,
      preview: [".gitconfig"],
      symlinkCount: 0,
      syncDirectory: "/tmp/dotweave",
    },
    recipientCount: 1,
    syncDirectory: "/tmp/dotweave",
  });
  mocked.untrackTarget.mockResolvedValue({
    configPath: "/tmp/config.json",
    localPath: "/tmp/home/.ssh/config",
    plainArtifactCount: 3,
    repoPath: ".ssh/config",
    secretArtifactCount: 0,
    syncDirectory: "/tmp/dotweave",
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
    syncDirectory: "/tmp/dotweave",
  });
  mocked.mkdir.mockResolvedValue(undefined);
  mocked.launchShellInDirectory.mockResolvedValue(undefined);
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
});

afterEach(() => {
  process.exitCode = undefined;
});

describe("CLI command modules", () => {
  it("initializes with an explicit key without prompting", async () => {
    await runCommand(
      initCommand,
      {
        key: "  AGE-SECRET-KEY-123  ",
        verbose: true,
      },
      "git@example.com:dotfiles.git",
    );

    expect(mocked.consolaPrompt).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith(
      {
        ageIdentity: "AGE-SECRET-KEY-123",
        generateAgeIdentity: false,
        recipients: [],
        repository: "git@example.com:dotfiles.git",
      },
      mockLogger,
    );
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Sync directory initialized",
    );
  });

  it("rejects a blank prompted key when importing an existing repository", async () => {
    mocked.pathExists.mockResolvedValue(false);
    mocked.consolaPrompt.mockResolvedValue("   ");

    await expect(
      runCommand(initCommand, { promptKey: true }, "origin"),
    ).rejects.toThrowError(
      /Existing repository setup requires an age private key/u,
    );

    expect(mocked.consolaPrompt).toHaveBeenCalledWith(
      "Enter the age private key for the existing repository: ",
      { type: "text", cancel: "reject" },
    );
    expect(mocked.initializeSyncDirectory).not.toHaveBeenCalled();
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
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Started tracking profiles/work/.gitconfig",
    );
    expect(mockLogger.log).toHaveBeenCalledWith(
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
      new DotweaveError("existing target", {
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
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Updated sync mode for .config/nvim",
    );
  });

  it("lists, uses, and clears profiles", async () => {
    await runCommand(profileListCommand, { verbose: true });
    await runCommand(profileUseCommand, { verbose: false }, "work");
    await runCommand(profileUseCommand, { verbose: true });

    expect(mocked.listProfiles).toHaveBeenCalledTimes(1);
    expect(mocked.setActiveProfile).toHaveBeenCalledWith("work");
    expect(mocked.clearActiveProfile).toHaveBeenCalledTimes(1);
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining("available: personal, work"),
    );
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Active profile set to work",
    );
    expect(mockLogger.success).toHaveBeenCalledWith("Active profile cleared");
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

    expect(mocked.preparePull).toHaveBeenCalledWith(
      {
        dryRun: true,
        profile: "work",
      },
      mockLogger,
    );
    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
    expect(mocked.pushChanges).toHaveBeenCalledWith(
      {
        dryRun: true,
        profile: "work",
      },
      undefined,
    );
    expect(mocked.getStatus).toHaveBeenCalledWith({
      profile: "work",
      reporter: mockLogger,
    });
    expect(mockLogger.info).toHaveBeenCalledWith("Sync status");
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining("Push changes"),
    );
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining("Pull changes"),
    );
  });

  it("skips prompting and exits when pull has no changes", async () => {
    mocked.preparePull.mockResolvedValueOnce({
      config: {
        entries: [],
        version: 7,
      },
      plan: {
        counts: {
          decryptedFileCount: 0,
          directoryCount: 0,
          plainFileCount: 0,
          symlinkCount: 0,
        },
        deletedLocalCount: 0,
        deletedLocalPaths: [],
        desiredKeys: new Set<string>(),
        existingKeys: new Set<string>(),
        materializations: [],
        updatedLocalPaths: [],
      },
      syncDirectory: "/tmp/dotweave",
    });

    await runCommand(pullCommand, { verbose: false });

    expect(mocked.consolaPrompt).not.toHaveBeenCalled();
    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Already up to date");
  });

  it("applies pull changes after interactive confirmation", async () => {
    mocked.consolaPrompt.mockResolvedValueOnce("y");

    await runCommand(pullCommand, { verbose: false });

    expect(mocked.consolaPrompt).toHaveBeenCalledWith(
      "Apply these changes? [y/N] ",
      { cancel: "reject", type: "text" },
    );
    expect(mocked.applyPullPlan).toHaveBeenCalledTimes(1);
    expect(mockLogger.success).toHaveBeenCalledWith("Pull complete");
  });

  it("cancels pull changes when confirmation is not y", async () => {
    mocked.consolaPrompt.mockResolvedValueOnce("n");

    await runCommand(pullCommand, { verbose: false });

    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Skipped pull changes");
  });

  it("skips prompting when --yes is provided", async () => {
    await runCommand(pullCommand, { verbose: false, yes: true });

    expect(mocked.consolaPrompt).not.toHaveBeenCalled();
    expect(mocked.applyPullPlan).toHaveBeenCalledTimes(1);
    expect(mockLogger.log).toHaveBeenCalledWith("  1 local paths updated");
    expect(mockLogger.log).toHaveBeenCalledWith("  1 local paths removed");
  });

  it("fails in non-interactive mode without --yes when changes exist", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    await expect(runCommand(pullCommand, { verbose: false })).rejects.toThrow(
      "Pull confirmation requires an interactive terminal.",
    );
    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
  });

  it("untracks tracked targets relative to the current working directory", async () => {
    await runCommand(untrackCommand, { verbose: true }, ".ssh/config");

    expect(mocked.untrackTarget).toHaveBeenCalledWith(
      {
        target: ".ssh/config",
      },
      process.cwd(),
    );
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Stopped tracking .ssh/config",
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
      syncDirectory: "/tmp/dotweave",
    });

    await runCommand(doctorCommand, { verbose: true });

    expect(mocked.runDoctorChecks).toHaveBeenCalledWith(mockLogger);
    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining("Doctor found issues"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("creates the sync directory before launching cd shells", async () => {
    await runCommand(cdCommand, { verbose: false });

    expect(mocked.resolveDotweaveSyncDirectory).toHaveBeenCalledTimes(1);
    expect(mocked.mkdir).toHaveBeenCalledWith("/tmp/dotweave", {
      recursive: true,
    });
    expect(mocked.launchShellInDirectory).toHaveBeenCalledWith("/tmp/dotweave");
  });
});
