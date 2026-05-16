import type { ApplicationContext, Command } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DotweaveError } from "#app/lib/error.ts";

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

const withoutAnsi = (value: unknown) => String(value).replace(ansiPattern, "");

const loggerCalls = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls.map(([message]) => withoutAnsi(message));

const mockLogger = vi.hoisted(() => ({
  divider: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  kv: vi.fn(),
  list: vi.fn(),
  listKeyValue: vi.fn(),
  log: vi.fn(),
  section: vi.fn(),
  spinner: vi.fn(() => ({
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    stop: vi.fn(),
  })),
  start: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}));

const mocked = vi.hoisted(() => ({
  addProfile: vi.fn(),
  applyPullPlan: vi.fn(),
  assignProfiles: vi.fn(),
  buildPullResultFromPlan: vi.fn(),
  clearActiveProfile: vi.fn(),
  createMissingRepositoryAgeKeyError: vi.fn(),
  getStatus: vi.fn(),
  initializeSyncDirectory: vi.fn(),
  installDotweaveSkill: vi.fn(),
  launchShellInDirectory: vi.fn(),
  listProfiles: vi.fn(),
  mkdir: vi.fn(),
  pathExists: vi.fn(),
  preparePull: vi.fn(),
  promptAsk: vi.fn(),
  pushChanges: vi.fn(),
  readFile: vi.fn(),
  readEnvValue: vi.fn(),
  resolveConfiguredAbsolutePath: vi.fn(),
  resolveDefaultIdentityFile: vi.fn(),
  resolveDotweaveConfigDirectory: vi.fn(),
  resolveDotweaveHomeDirectory: vi.fn(),
  resolveDotweaveSyncDirectory: vi.fn(),
  runDoctorChecks: vi.fn(),
  removeProfile: vi.fn(),
  setActiveProfile: vi.fn(),
  setTargetMode: vi.fn(),
  trackTarget: vi.fn(),
  untrackTarget: vi.fn(),
  validateProfilesExist: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mocked.mkdir,
  readFile: mocked.readFile,
}));

vi.mock("#app/config/xdg.ts", () => ({
  resolveConfiguredAbsolutePath: mocked.resolveConfiguredAbsolutePath,
  resolveDotweaveConfigDirectory: mocked.resolveDotweaveConfigDirectory,
}));

vi.mock("#app/config/runtime-env.ts", () => ({
  readEnvValue: mocked.readEnvValue,
  resolveDotweaveHomeDirectoryFromEnv: mocked.resolveDotweaveHomeDirectory,
  resolveDotweaveSyncDirectoryFromEnv: mocked.resolveDotweaveSyncDirectory,
}));

vi.mock("#app/config/identity-file.ts", () => ({
  resolveDefaultIdentityFile: mocked.resolveDefaultIdentityFile,
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
  createMissingRepositoryAgeKeyError: mocked.createMissingRepositoryAgeKeyError,
  initializeSyncDirectory: mocked.initializeSyncDirectory,
}));

vi.mock("#app/services/skill-install.ts", () => ({
  installDotweaveSkill: mocked.installDotweaveSkill,
}));

vi.mock("#app/services/profile.ts", () => ({
  addProfile: mocked.addProfile,
  assignProfiles: mocked.assignProfiles,
  clearActiveProfile: mocked.clearActiveProfile,
  listProfiles: mocked.listProfiles,
  removeProfile: mocked.removeProfile,
  setActiveProfile: mocked.setActiveProfile,
  validateProfilesExist: mocked.validateProfilesExist,
}));

vi.mock("#app/services/pull.ts", () => ({
  applyPullPlan: mocked.applyPullPlan,
  buildPullResultFromPlan: mocked.buildPullResultFromPlan,
  preparePull: mocked.preparePull,
}));

vi.mock("#app/services/push.ts", () => ({
  pushChanges: mocked.pushChanges,
}));

vi.mock("#app/services/sync-mode.ts", () => ({
  setTargetMode: mocked.setTargetMode,
}));

vi.mock("#app/services/status.ts", () => ({
  getStatus: mocked.getStatus,
}));

vi.mock("#app/lib/prompt.ts", () => ({
  ask: mocked.promptAsk,
}));

vi.mock("#app/services/terminal/logger.ts", () => ({
  createCliLogger: vi.fn(() => mockLogger),
}));

vi.mock("#app/services/terminal/shell.ts", () => ({
  launchShellInDirectory: mocked.launchShellInDirectory,
}));

import cdCommand from "./cd.ts";
import doctorCommand from "./doctor.ts";
import initCommand from "./init.ts";
import profileAddCommand from "./profile/add.ts";
import profileListCommand from "./profile/list.ts";
import profileRemoveCommand from "./profile/remove.ts";
import profileUseCommand from "./profile/use.ts";
import pullCommand from "./pull.ts";
import pushCommand from "./push.ts";
import skillInstallCommand from "./skill/install.ts";
import statusCommand from "./status.ts";
import trackCommand from "./track.ts";
import untrackCommand from "./untrack.ts";

const runCommand = async (
  command: Command<ApplicationContext>,
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

  const mockContext: ApplicationContext = {
    process: {
      stdout: process.stdout,
      stderr: process.stderr,
    },
  };

  await func?.call(mockContext, flags, ...args);
};

beforeEach(() => {
  process.exitCode = undefined;
  vi.clearAllMocks();

  mocked.resolveDefaultIdentityFile.mockReturnValue("/tmp/keys.txt");
  mocked.resolveConfiguredAbsolutePath.mockReturnValue("/tmp/keys.txt");
  mocked.resolveDotweaveHomeDirectory.mockReturnValue("/tmp/dotweave");
  mocked.resolveDotweaveSyncDirectory.mockReturnValue("/tmp/dotweave");
  mocked.pathExists.mockResolvedValue(true);
  mocked.promptAsk.mockResolvedValue(undefined);
  mocked.readFile.mockResolvedValue("AGE-SECRET-KEY-FILE\n");
  mocked.createMissingRepositoryAgeKeyError.mockImplementation(() => {
    return new DotweaveError(
      "Existing repository setup requires an age private key.",
    );
  });
  mocked.initializeSyncDirectory.mockResolvedValue({
    alreadyInitialized: false,
    entryCount: 0,
    generatedIdentity: false,
    gitAction: "cloned",
    gitSource: "git@example.com:dotfiles.git",
    identityFile: "/tmp/keys.txt",
    recipientCount: 1,
  });
  mocked.installDotweaveSkill.mockResolvedValue({
    action: "installed",
    dryRun: false,
    targetPath: "/tmp/skills/dotweave/SKILL.md",
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
  mocked.trackTarget.mockResolvedValue({
    alreadyTracked: false,
    changed: true,
    kind: "file",
    localPath: "/tmp/home/.gitconfig",
    mode: "secret",
    profiles: ["work"],
    repoPath: "profiles/work/.gitconfig",
  });
  mocked.setTargetMode.mockResolvedValue({
    action: "updated",
    entryRepoPath: ".config/nvim",
    localPath: "/tmp/home/.config/nvim",
    mode: "ignore",
    repoPath: ".config/nvim",
  });
  mocked.assignProfiles.mockResolvedValue(undefined);
  mocked.validateProfilesExist.mockResolvedValue(["work"]);
  mocked.addProfile.mockResolvedValue({
    action: "added",
    profile: "work",
  });
  mocked.removeProfile.mockResolvedValue({
    action: "removed",
    profile: "work",
  });
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
    availableProfiles: ["default", "personal", "work"],
    globalConfigExists: true,
    globalConfigPath: "/tmp/global-config.json",
  });
  mocked.setActiveProfile.mockResolvedValue({
    action: "use",
    activeProfile: "work",
    globalConfigPath: "/tmp/global-config.json",
    profile: "work",
  });
  mocked.clearActiveProfile.mockResolvedValue({
    action: "clear",
    globalConfigPath: "/tmp/global-config.json",
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
    decryptedFileCount: 2,
    deletedLocalCount: 1,
    directoryCount: 1,
    dryRun: true,
    plainFileCount: 3,
    symlinkCount: 0,
  });
  mocked.pushChanges.mockResolvedValue({
    deletedArtifactCount: 2,
    directoryCount: 1,
    dryRun: true,
    encryptedFileCount: 2,
    plainFileCount: 1,
    symlinkCount: 0,
  });
  mocked.getStatus.mockResolvedValue({
    activeProfile: "work",
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
      decryptedFileCount: 2,
      deletedLocalCount: 1,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 3,
      preview: [".gitconfig"],
      symlinkCount: 0,
    },
    push: {
      changes: {
        added: [".gitconfig"],
        modified: [],
        deleted: [".oldconfig"],
      },
      deletedArtifactCount: 2,
      directoryCount: 1,
      dryRun: true,
      encryptedFileCount: 2,
      plainFileCount: 1,
      preview: [".gitconfig"],
      symlinkCount: 0,
    },
    recipientCount: 1,
  });
  mocked.untrackTarget.mockResolvedValue({
    localPath: "/tmp/home/.ssh/config",
    plainArtifactCount: 3,
    repoPath: ".ssh/config",
    secretArtifactCount: 0,
  });
  mocked.runDoctorChecks.mockResolvedValue({
    checks: [
      {
        checkId: "git",
        detail: "Sync directory is a git repository.",
        level: "ok",
      },
    ],
    hasFailures: false,
    hasWarnings: false,
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
  it("initializes without a repository and generates an identity when none exists", async () => {
    mocked.pathExists.mockResolvedValue(false);

    await runCommand(initCommand, {});

    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: undefined,
      force: false,
      generateAgeIdentity: true,
      recipients: [],
      repository: undefined,
    });
  });

  it("initializes with force without a repository and treats an existing identity as reset", async () => {
    mocked.pathExists.mockResolvedValue(true);

    await runCommand(initCommand, { force: true });

    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: undefined,
      force: true,
      generateAgeIdentity: true,
      recipients: [],
      repository: undefined,
    });
  });

  it("initializes from a repository without prompting when an identity exists", async () => {
    mocked.pathExists.mockResolvedValue(true);

    await runCommand(initCommand, {}, "git@example.com:dotfiles.git");

    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: undefined,
      force: false,
      generateAgeIdentity: false,
      recipients: [],
      repository: "git@example.com:dotfiles.git",
    });
  });

  it("initializes from a repository with an age key file without prompting", async () => {
    mocked.readFile.mockResolvedValue("  AGE-SECRET-KEY-FILE  \n");

    await runCommand(
      initCommand,
      {
        keyFile: "/tmp/import.agekey",
      },
      "git@example.com:dotfiles.git",
    );

    expect(mocked.readFile).toHaveBeenCalledWith("/tmp/import.agekey", "utf8");
    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: "AGE-SECRET-KEY-FILE",
      force: false,
      generateAgeIdentity: false,
      recipients: [],
      repository: "git@example.com:dotfiles.git",
    });
    const spin = mockLogger.spinner.mock.results[0]?.value;
    expect(spin.succeed).toHaveBeenCalledWith("Sync directory initialized");
  });

  it("initializes with force from a repository with an age key file without prompting", async () => {
    mocked.readFile.mockResolvedValue("AGE-SECRET-KEY-FORCE\n");

    await runCommand(
      initCommand,
      {
        force: true,
        keyFile: "/tmp/force.agekey",
      },
      "git@example.com:dotfiles.git",
    );

    expect(mocked.readFile).toHaveBeenCalledWith("/tmp/force.agekey", "utf8");
    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: "AGE-SECRET-KEY-FORCE",
      force: true,
      generateAgeIdentity: false,
      recipients: [],
      repository: "git@example.com:dotfiles.git",
    });
  });

  it("initializes without a repository using an age key file without generating", async () => {
    mocked.readFile.mockResolvedValue("AGE-SECRET-KEY-LOCAL\n");

    await runCommand(initCommand, {
      keyFile: "/tmp/local.agekey",
    });

    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: "AGE-SECRET-KEY-LOCAL",
      force: false,
      generateAgeIdentity: false,
      recipients: [],
      repository: undefined,
    });
  });

  it("initializes with force from a repository by prompting even when an identity exists", async () => {
    mocked.pathExists.mockResolvedValue(true);
    mocked.promptAsk.mockResolvedValue("  AGE-SECRET-KEY-PROMPTED  ");

    await runCommand(
      initCommand,
      {
        force: true,
      },
      "git@example.com:dotfiles.git",
    );

    expect(mocked.promptAsk).toHaveBeenCalledWith(
      "Enter the age private key for the existing repository: ",
    );
    expect(mocked.initializeSyncDirectory).toHaveBeenCalledWith({
      ageIdentity: "AGE-SECRET-KEY-PROMPTED",
      force: true,
      generateAgeIdentity: false,
      recipients: [],
      repository: "git@example.com:dotfiles.git",
    });
  });

  it("rejects a blank prompted key when importing an existing repository", async () => {
    mocked.pathExists.mockResolvedValue(false);
    mocked.promptAsk.mockResolvedValue("   ");

    await expect(runCommand(initCommand, {}, "origin")).rejects.toThrowError(
      /Existing repository setup requires an age private key/u,
    );

    expect(mocked.promptAsk).toHaveBeenCalledWith(
      "Enter the age private key for the existing repository: ",
    );
    expect(mocked.initializeSyncDirectory).not.toHaveBeenCalled();
  });

  it("exposes only force and key-file flags for init credentials", () => {
    expect(Object.keys(initCommand.parameters.flags ?? {}).sort()).toEqual([
      "force",
      "keyFile",
    ]);
  });

  it("tracks new targets and formats track output", async () => {
    await runCommand(
      trackCommand,
      {
        mode: "secret",
        profile: ["work"],
        repoPath: "profiles/work/.gitconfig",
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
    expect(mockLogger.listKeyValue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ key: "path" }),
        expect.objectContaining({ key: "mode" }),
        expect.objectContaining({ key: "profiles", value: "work" }),
      ]),
    );
  });

  it("installs the bundled dotweave skill and reports the target path", async () => {
    mocked.installDotweaveSkill.mockResolvedValueOnce({
      action: "would-install",
      dryRun: true,
      targetPath: "/tmp/skills/dotweave/SKILL.md",
    });

    await runCommand(
      skillInstallCommand,
      {
        dryRun: true,
        force: true,
      },
      "/tmp/skills",
    );

    expect(mocked.installDotweaveSkill).toHaveBeenCalledWith({
      directory: "/tmp/skills",
      dryRun: true,
      force: true,
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Would install dotweave skill",
    );
    expect(mockLogger.kv).toHaveBeenCalledWith(
      "target",
      "/tmp/skills/dotweave/SKILL.md",
    );
  });

  it("rejects --repo-path when tracking multiple targets", async () => {
    await expect(
      runCommand(
        trackCommand,
        {
          mode: "normal",
          repoPath: "profiles/shared/tool",
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
      { mode: "ignore", profile: [""] },
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

  it("validates fallback track profiles before writing mode updates", async () => {
    mocked.trackTarget.mockRejectedValue(
      new DotweaveError("existing target", {
        code: "TARGET_NOT_FOUND",
      }),
    );
    mocked.validateProfilesExist.mockRejectedValue(
      new DotweaveError("Unknown profile 'ghost'.", {
        code: "UNKNOWN_PROFILE",
      }),
    );

    await expect(
      runCommand(
        trackCommand,
        { mode: "ignore", profile: ["ghost"] },
        ".config/nvim",
      ),
    ).rejects.toThrowError("Unknown profile 'ghost'.");

    expect(mocked.validateProfilesExist).toHaveBeenCalledWith(["ghost"]);
    expect(mocked.setTargetMode).not.toHaveBeenCalled();
    expect(mocked.assignProfiles).not.toHaveBeenCalled();
  });

  it("lists, adds, removes, uses, and clears profiles", async () => {
    await runCommand(profileListCommand, {});
    await runCommand(profileAddCommand, {}, "work");
    await runCommand(profileRemoveCommand, {}, "work");
    await runCommand(profileUseCommand, {}, "work");
    await runCommand(profileUseCommand, {});

    expect(mocked.listProfiles).toHaveBeenCalledTimes(1);
    expect(mocked.addProfile).toHaveBeenCalledWith("work");
    expect(mocked.removeProfile).toHaveBeenCalledWith("work");
    expect(mocked.setActiveProfile).toHaveBeenCalledWith("work");
    expect(mocked.clearActiveProfile).toHaveBeenCalledTimes(1);
    expect(mockLogger.list).toHaveBeenCalledWith(
      expect.arrayContaining(["personal", expect.stringContaining("work")]),
      expect.any(Object),
    );
    expect(mockLogger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("restricted entries"),
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("restricted entries"),
    );
    expect(mockLogger.success).toHaveBeenCalledWith("Added profile work");
    expect(mockLogger.success).toHaveBeenCalledWith("Removed profile work");
    expect(mockLogger.success).toHaveBeenCalledWith(
      "Active profile set to work",
    );
    expect(mockLogger.success).toHaveBeenCalledWith("Active profile cleared");
  });

  it("warns when listing profiles with an unregistered active profile", async () => {
    mocked.listProfiles.mockResolvedValueOnce({
      activeProfile: "ghost",
      activeProfileMode: "single",
      activeProfileWarning:
        "Active profile 'ghost' is not registered in manifest.jsonc.",
      assignments: [],
      availableProfiles: ["default", "work"],
      globalConfigExists: true,
      globalConfigPath: "/tmp/global-config.json",
    });

    await runCommand(profileListCommand, {});

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Active profile 'ghost' is not registered in manifest.jsonc.",
    );
  });

  it("marks default active when listing profiles without an explicit active profile", async () => {
    mocked.listProfiles.mockResolvedValueOnce({
      activeProfile: "default",
      activeProfileMode: "none",
      assignments: [],
      availableProfiles: ["default", "work"],
      globalConfigExists: false,
      globalConfigPath: "/tmp/global-config.json",
    });

    await runCommand(profileListCommand, {});

    expect(mockLogger.list).toHaveBeenCalledWith(["default (active)", "work"], {
      highlightLast: false,
    });
  });

  it("passes pull, push, and status flags through with a shared reporter", async () => {
    await runCommand(pullCommand, {
      dryRun: true,
      profile: "work",
    });
    await runCommand(pushCommand, {
      dryRun: true,
      profile: "work",
    });
    await runCommand(statusCommand, { profile: "work" });

    expect(mocked.preparePull).toHaveBeenCalledWith({
      dryRun: true,
      profile: "work",
    });
    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
    expect(mocked.pushChanges).toHaveBeenCalledWith({
      dryRun: true,
      profile: "work",
    });
    expect(mocked.getStatus).toHaveBeenCalledWith({
      profile: "work",
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining("Sync status"),
    );
    expect(mockLogger.section).toHaveBeenCalledWith(
      expect.stringContaining("Push changes"),
    );
    expect(mockLogger.section).toHaveBeenCalledWith(
      expect.stringContaining("Pull changes"),
    );
  });

  it("stops the push spinner when push planning rejects", async () => {
    const error = new DotweaveError("Failed to plan push.");
    mocked.pushChanges.mockRejectedValueOnce(error);

    await expect(runCommand(pushCommand, {})).rejects.toBe(error);

    const spin = mockLogger.spinner.mock.results[0]?.value;
    expect(spin.stop).toHaveBeenCalledOnce();
    expect(spin.succeed).not.toHaveBeenCalled();
  });

  it("stops the prepare pull spinner when planning rejects", async () => {
    const error = new DotweaveError("Failed to prepare pull.");
    mocked.preparePull.mockRejectedValueOnce(error);

    await expect(runCommand(pullCommand, {})).rejects.toBe(error);

    const spin = mockLogger.spinner.mock.results[0]?.value;
    expect(spin.stop).toHaveBeenCalledOnce();
    expect(spin.succeed).not.toHaveBeenCalled();
  });

  it("stops the apply pull spinner when applying rejects", async () => {
    const error = new DotweaveError("Failed to apply pull.");
    mocked.applyPullPlan.mockRejectedValueOnce(error);

    await expect(runCommand(pullCommand, { yes: true })).rejects.toBe(error);

    const prepareSpin = mockLogger.spinner.mock.results[0]?.value;
    const applySpin = mockLogger.spinner.mock.results[1]?.value;
    expect(prepareSpin.stop).toHaveBeenCalledOnce();
    expect(applySpin.stop).toHaveBeenCalledOnce();
    expect(applySpin.succeed).not.toHaveBeenCalled();
  });

  it("stops the status spinner when status calculation rejects", async () => {
    const error = new DotweaveError("Failed to check status.");
    mocked.getStatus.mockRejectedValueOnce(error);

    await expect(runCommand(statusCommand, {})).rejects.toBe(error);

    const spin = mockLogger.spinner.mock.results[0]?.value;
    expect(spin.stop).toHaveBeenCalledOnce();
  });

  it("formats status output for every push and pull change category", async () => {
    mocked.getStatus.mockResolvedValueOnce({
      activeProfile: "work",
      entries: [
        {
          kind: "file",
          localPath: "/tmp/home/.config/new.toml",
          mode: "normal",
          profiles: ["work"],
          repoPath: ".config/new.toml",
        },
        {
          kind: "file",
          localPath: "/tmp/home/.config/app.toml",
          mode: "normal",
          profiles: ["work"],
          repoPath: ".config/app.toml",
        },
        {
          kind: "file",
          localPath: "/tmp/home/.config/old.toml",
          mode: "normal",
          profiles: ["work"],
          repoPath: ".config/old.toml",
        },
      ],
      entryCount: 3,
      pull: {
        changes: {
          updated: ["/tmp/home/.config/app.toml"],
          deleted: ["/tmp/home/.config/obsolete.toml"],
        },
        decryptedFileCount: 0,
        deletedLocalCount: 1,
        directoryCount: 0,
        dryRun: true,
        plainFileCount: 1,
        preview: [".config/app.toml"],
        symlinkCount: 0,
      },
      push: {
        changes: {
          added: [".config/new.toml"],
          modified: [".config/app.toml"],
          deleted: [".config/old.toml"],
        },
        deletedArtifactCount: 1,
        directoryCount: 0,
        dryRun: true,
        encryptedFileCount: 0,
        plainFileCount: 2,
        preview: [".config/app.toml"],
        symlinkCount: 0,
      },
      recipientCount: 2,
    });

    await runCommand(statusCommand, { profile: "work" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Sync status — 3 entries, 2 recipients, profile: work",
    );

    const sections = mockLogger.section.mock.calls.map(([message]) =>
      withoutAnsi(message),
    );
    expect(sections).toEqual(
      expect.arrayContaining([
        "Push changes (repository)",
        "Add (1)",
        "Modify (1)",
        "Delete (1)",
        "Pull changes (local)",
        "Changed (1)",
        "Remove (1)",
      ]),
    );

    const logLines = mockLogger.log.mock.calls.map(([message]) =>
      withoutAnsi(message),
    );
    expect(logLines).toEqual(
      expect.arrayContaining([
        "  + .config/new.toml",
        "  ~ .config/app.toml",
        "  - .config/old.toml",
        "  + /tmp/home/.config/app.toml",
        "  - /tmp/home/.config/obsolete.toml",
      ]),
    );
  });

  it("truncates long status change lists after ten items", async () => {
    mocked.getStatus.mockResolvedValueOnce({
      entries: [],
      entryCount: 0,
      pull: {
        changes: {
          updated: [],
          deleted: [],
        },
        decryptedFileCount: 0,
        deletedLocalCount: 0,
        directoryCount: 0,
        dryRun: true,
        plainFileCount: 0,
        preview: [],
        symlinkCount: 0,
      },
      push: {
        changes: {
          added: Array.from(
            { length: 12 },
            (_, index) => `.config/generated-${index + 1}.toml`,
          ),
          modified: [],
          deleted: [],
        },
        deletedArtifactCount: 0,
        directoryCount: 0,
        dryRun: true,
        encryptedFileCount: 0,
        plainFileCount: 12,
        preview: [],
        symlinkCount: 0,
      },
      recipientCount: 1,
    });

    await runCommand(statusCommand, {});

    expect(mockLogger.section).toHaveBeenCalledWith("Add (12)");
    expect(mockLogger.info).toHaveBeenCalledWith(
      "Sync status — 0 entries, 1 recipients, profile: default",
    );

    const logLines = mockLogger.log.mock.calls.map(([message]) =>
      withoutAnsi(message),
    );
    expect(logLines).toContain("  + .config/generated-10.toml");
    expect(logLines).not.toContain("  + .config/generated-11.toml");
    expect(logLines).toContain("  ... and 2 more");
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

    await runCommand(pullCommand, {});

    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Already up to date");
  });

  it("applies pull changes after interactive confirmation", async () => {
    mocked.promptAsk.mockResolvedValueOnce("y");

    await runCommand(pullCommand, {});

    expect(mocked.promptAsk).toHaveBeenCalledWith(
      "Apply these changes? [y/N] ",
    );
    expect(mocked.applyPullPlan).toHaveBeenCalledTimes(1);
    const applySpin = mockLogger.spinner.mock.results[1]?.value;
    expect(applySpin?.succeed).toHaveBeenCalledWith("Pull complete");
  });

  it("cancels pull changes when confirmation is not y", async () => {
    mocked.promptAsk.mockResolvedValueOnce("n");

    await runCommand(pullCommand, {});

    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith("Skipped pull changes");
  });

  it("skips prompting when --yes is provided", async () => {
    await runCommand(pullCommand, { yes: true });

    expect(mocked.promptAsk).not.toHaveBeenCalled();
    expect(mocked.applyPullPlan).toHaveBeenCalledTimes(1);
    const applySpin = mockLogger.spinner.mock.results[1]?.value;
    expect(applySpin?.succeed).toHaveBeenCalledWith("Pull complete");
    expect(mockLogger.kv).toHaveBeenCalledWith(
      "updated",
      expect.stringContaining("1 paths"),
    );
    expect(mockLogger.kv).toHaveBeenCalledWith(
      "removed",
      expect.stringContaining("1 paths"),
    );
  });

  it("fails in non-interactive mode without --yes when changes exist", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });

    await expect(runCommand(pullCommand, {})).rejects.toThrow(
      "Pull confirmation requires an interactive terminal.",
    );
    expect(mocked.applyPullPlan).not.toHaveBeenCalled();
  });

  it("untracks tracked targets relative to the current working directory", async () => {
    await runCommand(untrackCommand, {}, ".ssh/config");

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

  it("marks doctor failures by throwing with exit code", async () => {
    mocked.runDoctorChecks.mockResolvedValue({
      checks: [
        {
          checkId: "age",
          detail: "Age identity file is missing: /tmp/keys.txt.",
          level: "fail",
        },
      ],
      hasFailures: true,
      hasWarnings: false,
    });

    await expect(runCommand(doctorCommand, {})).rejects.toThrow(
      "Doctor found issues.",
    );

    expect(mocked.runDoctorChecks).toHaveBeenCalled();
    expect(mockLogger.fail).toHaveBeenCalledWith(
      expect.stringContaining("Doctor found issues"),
    );
  });

  it("formats successful doctor checks with an all-pass summary", async () => {
    mocked.runDoctorChecks.mockResolvedValueOnce({
      checks: [
        {
          checkId: "git",
          detail: "Sync directory is a git repository.",
          level: "ok",
        },
        {
          checkId: "config",
          detail: "Loaded config.",
          level: "ok",
        },
      ],
      hasFailures: false,
      hasWarnings: false,
    });

    await runCommand(doctorCommand, {});

    expect(loggerCalls(mockLogger.success)).toContain(
      "Doctor passed (2 ok · 0 warnings · 0 failures)",
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.fail).not.toHaveBeenCalled();
    expect(mockLogger.log).not.toHaveBeenCalled();
  });

  it("formats doctor warnings with remapped check ids and distinct warn labels", async () => {
    mocked.runDoctorChecks.mockResolvedValueOnce({
      checks: [
        {
          checkId: "git",
          detail: "Sync directory is a git repository.",
          level: "ok",
        },
        {
          checkId: "entries",
          detail: "No sync entries are configured yet.",
          level: "warn",
        },
        {
          checkId: "local-paths",
          detail: "Tracked local paths need attention.",
          level: "warn",
        },
      ],
      hasFailures: false,
      hasWarnings: true,
    });

    await runCommand(doctorCommand, {});

    expect(loggerCalls(mockLogger.warn)).toContain(
      "Doctor completed with warnings (1 ok · 2 warnings · 0 failures)",
    );
    expect(loggerCalls(mockLogger.log)).toEqual([
      "  ⚠ entries — No sync entries are configured yet",
      "  ⚠ local — Tracked local paths need attention",
    ]);
    expect(loggerCalls(mockLogger.log)).not.toContain(
      expect.stringContaining("✖ entries"),
    );
  });

  it("formats doctor failures with remapped age id and throws an exit-coded error", async () => {
    mocked.runDoctorChecks.mockResolvedValueOnce({
      checks: [
        {
          checkId: "age",
          detail: "Age identity file is missing: /tmp/keys.txt.",
          level: "fail",
        },
      ],
      hasFailures: true,
      hasWarnings: false,
    });

    await expect(runCommand(doctorCommand, {})).rejects.toMatchObject({
      exitCode: 1,
      message: "Doctor found issues.",
    });

    expect(loggerCalls(mockLogger.fail)).toContain(
      "Doctor found issues (0 ok · 0 warnings · 1 failures)",
    );
    expect(loggerCalls(mockLogger.log)).toEqual([
      "  ✖ identity — Age identity file is missing: /tmp/keys.txt",
    ]);
  });

  it("truncates doctor issue details after three non-ok checks", async () => {
    mocked.runDoctorChecks.mockResolvedValueOnce({
      checks: [
        {
          checkId: "entries",
          detail: "No sync entries are configured yet.",
          level: "warn",
        },
        {
          checkId: "age",
          detail: "Age identity file is missing: /tmp/keys.txt.",
          level: "fail",
        },
        {
          checkId: "local-paths",
          detail: "Tracked local paths need attention.",
          level: "warn",
        },
        {
          checkId: "config",
          detail: "Sync configuration could not be read.",
          level: "fail",
        },
        {
          checkId: "profiles",
          detail: "Active profile is not registered.",
          level: "warn",
        },
      ],
      hasFailures: true,
      hasWarnings: true,
    });

    await expect(runCommand(doctorCommand, {})).rejects.toThrow(
      "Doctor found issues.",
    );

    expect(loggerCalls(mockLogger.log)).toEqual([
      "  ⚠ entries — No sync entries are configured yet",
      "  ✖ identity — Age identity file is missing: /tmp/keys.txt",
      "  ⚠ local — Tracked local paths need attention",
      "  ... 2 more issues",
    ]);
  });

  it("creates the sync directory before launching cd shells", async () => {
    await runCommand(cdCommand, {});

    expect(mocked.resolveDotweaveSyncDirectory).toHaveBeenCalledTimes(1);
    expect(mocked.mkdir).toHaveBeenCalledWith("/tmp/dotweave", {
      recursive: true,
    });
    expect(mocked.launchShellInDirectory).toHaveBeenCalledWith("/tmp/dotweave");
  });
});
