import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import * as platformConfig from "#app/config/platform.js";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.js";
import { trackSyncTarget } from "./add.js";
import { initializeSync } from "./init.js";
import {
  assignSyncProfiles,
  clearSyncProfiles,
  listSyncProfiles,
  useSyncProfile,
} from "./profile.js";
import { pullSync } from "./pull.js";
import { pushSync } from "./push.js";
import { setSyncTargetMode } from "./set.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-sync-test-");

  temporaryDirectories.push(directory);

  return directory;
};

const createSyncEnvironment = (
  homeDirectory: string,
  xdgConfigHome: string,
): NodeJS.ProcessEnv => {
  return {
    HOME: homeDirectory,
    XDG_CONFIG_HOME: xdgConfigHome,
  };
};

afterEach(async () => {
  vi.restoreAllMocks();

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("sync service", () => {
  it("tracks entries in v7 manifest format", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sharedDirectory = join(homeDirectory, ".config", "zsh");
    const workFile = join(homeDirectory, ".gitconfig-work");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sharedDirectory, { recursive: true });
    await writeFile(
      join(sharedDirectory, "secrets.zsh"),
      "export TOKEN=work\n",
    );
    await writeFile(workFile, "[include]\npath=~/.gitconfig.work\n");

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    await trackSyncTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      environment,
      cwd,
    );
    await trackSyncTarget(
      {
        mode: "secret",
        target: workFile,
      },
      environment,
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as {
      entries: Array<Record<string, unknown>>;
      version: number;
    };

    expect(config.version).toBe(7);
    expect(config).toHaveProperty("age");
    expect(config.entries).toEqual([
      {
        kind: "directory",
        localPath: { default: "~/.config/zsh" },
        mode: { default: "normal" },
      },
      {
        kind: "file",
        localPath: { default: "~/.gitconfig-work" },
        mode: { default: "secret" },
      },
    ]);
  });

  it("collapses redundant WSL mode overrides when tracking an existing root", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "mytool");
    const ageKeys = await createAgeKeyPair();
    const environment = {
      ...createSyncEnvironment(homeDirectory, xdgConfigHome),
      WSL_DISTRO_NAME: "Ubuntu",
    };
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await writeFile(
      join(xdgConfigHome, "devsync", "sync", "manifest.json"),
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "directory",
              localPath: { default: "~/.config/mytool" },
              mode: { default: "secret", wsl: "secret" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await trackSyncTarget(
      {
        mode: "secret",
        target: bundleDirectory,
      },
      environment,
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{ mode?: { default: string; wsl?: string } }>;
    };

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(config.entries[0]?.mode).toEqual({ default: "secret" });
  });

  it("manages the active profile through the global config", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sharedDirectory = join(homeDirectory, ".config", "zsh");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sharedDirectory, { recursive: true });
    await writeFile(
      join(sharedDirectory, "secrets.zsh"),
      "export TOKEN=work\n",
    );

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await trackSyncTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      environment,
      cwd,
    );
    await setSyncTargetMode(
      {
        mode: "secret",
        target: join(sharedDirectory, "secrets.zsh"),
      },
      environment,
      cwd,
    );

    expect(await useSyncProfile("work", environment)).toMatchObject({
      action: "use",
      activeProfile: "work",
      profile: "work",
    });
    expect(await clearSyncProfiles(environment)).toMatchObject({
      action: "clear",
    });
  });

  it("collapses redundant WSL mode overrides when updating an existing entry mode", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();
    const environment = {
      ...createSyncEnvironment(homeDirectory, xdgConfigHome),
      WSL_DISTRO_NAME: "Ubuntu",
    };
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await writeFile(
      join(xdgConfigHome, "devsync", "sync", "manifest.json"),
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
              mode: { default: "secret", wsl: "secret" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await setSyncTargetMode(
      {
        mode: "secret",
        target: gitconfig,
      },
      environment,
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{ mode?: { default: string; wsl?: string } }>;
    };

    expect(result.action).toBe("updated");
    expect(config.entries[0]?.mode).toEqual({ default: "secret" });
  });

  it("pushes and pulls with the active profile", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const sharedFile = join(zshDirectory, "zshrc");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(sharedFile, "export PATH=$PATH:$HOME/bin\n");
    await writeFile(secretsFile, "export TOKEN=work\n");

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await trackSyncTarget(
      {
        mode: "normal",
        target: zshDirectory,
      },
      environment,
      cwd,
    );
    await setSyncTargetMode(
      {
        mode: "secret",
        target: secretsFile,
      },
      environment,
      cwd,
    );

    await pushSync(
      {
        dryRun: false,
      },
      environment,
    );

    const sharedArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "default",
      ".config",
      "zsh",
      "zshrc",
    );
    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "default",
      ".config",
      "zsh",
      "secrets.zsh.devsync.secret",
    );

    expect(await readFile(sharedArtifact, "utf8")).toContain("PATH");
    expect(await readFile(secretArtifact, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );

    await writeFile(secretsFile, "local-change\n");
    await pullSync(
      {
        dryRun: false,
      },
      environment,
    );

    expect(await readFile(secretsFile, "utf8")).toContain("TOKEN=work");

    await setSyncTargetMode(
      {
        mode: "normal",
        target: secretsFile,
      },
      environment,
      cwd,
    );

    const configAfterModeChange = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        localPath: { default: string };
        mode?: { default: string };
      }>;
    };
    const secretEntry = configAfterModeChange.entries.find(
      (entry) => entry.localPath.default === "~/.config/zsh/secrets.zsh",
    );

    expect(secretEntry?.mode).toEqual({ default: "normal" });
  });

  it("skips Windows-ignored secret artifacts during pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();
    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const platformSpy = vi.spyOn(platformConfig, "detectCurrentPlatformKey");

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=linux\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await writeFile(
      join(xdgConfigHome, "devsync", "sync", "manifest.json"),
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "directory",
              localPath: { default: "~/.config/zsh" },
              mode: { default: "normal", win: "ignore" },
            },
            {
              kind: "file",
              localPath: { default: "~/.config/zsh/secrets.zsh" },
              mode: { default: "secret", win: "ignore" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    platformSpy.mockReturnValue("linux");
    await pushSync(
      {
        dryRun: false,
      },
      environment,
    );

    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "default",
      ".config",
      "zsh",
      "secrets.zsh.devsync.secret",
    );
    expect(await readFile(secretArtifact, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );

    await writeFile(secretsFile, "local-change\n");

    platformSpy.mockReturnValue("win");
    await expect(
      pullSync(
        {
          dryRun: false,
        },
        environment,
      ),
    ).resolves.toMatchObject({
      decryptedFileCount: 0,
    });

    expect(await readFile(secretsFile, "utf8")).toBe("local-change\n");
  });

  it("does not delete Windows-ignored artifacts during push", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();
    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const platformSpy = vi.spyOn(platformConfig, "detectCurrentPlatformKey");

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=linux\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await writeFile(
      join(xdgConfigHome, "devsync", "sync", "manifest.json"),
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "directory",
              localPath: { default: "~/.config/zsh" },
              mode: { default: "normal", win: "ignore" },
            },
            {
              kind: "file",
              localPath: { default: "~/.config/zsh/secrets.zsh" },
              mode: { default: "secret", win: "ignore" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    platformSpy.mockReturnValue("linux");
    await pushSync(
      {
        dryRun: false,
      },
      environment,
    );

    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "default",
      ".config",
      "zsh",
      "secrets.zsh.devsync.secret",
    );
    expect(await readFile(secretArtifact, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );

    platformSpy.mockReturnValue("win");
    const result = await pushSync(
      {
        dryRun: false,
      },
      environment,
    );

    expect(result.deletedArtifactCount).toBe(0);
    expect(await readFile(secretArtifact, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );
  });

  it("restores file permission from entry permission on pull", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sshDirectory = join(homeDirectory, ".ssh");
    const keyFile = join(sshDirectory, "id_rsa");
    const ageKeys = await createAgeKeyPair();
    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(keyFile, "fake-private-key\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    await writeFile(
      join(xdgConfigHome, "devsync", "sync", "manifest.json"),
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.ssh/id_rsa" },
              mode: { default: "secret" },
              permission: { default: "0600" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await pushSync({ dryRun: false }, environment);
    await writeFile(keyFile, "modified-content\n");
    await pullSync({ dryRun: false }, environment);

    expect(await readFile(keyFile, "utf8")).toBe("fake-private-key\n");
    const stats = await lstat(keyFile);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("restores directory entry permission to child files on pull", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sshDirectory = join(homeDirectory, ".ssh");
    const keyFile = join(sshDirectory, "id_rsa");
    const configFile = join(sshDirectory, "config");
    const ageKeys = await createAgeKeyPair();
    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(keyFile, "fake-private-key\n");
    await writeFile(configFile, "Host *\n  AddKeysToAgent yes\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    await writeFile(
      join(xdgConfigHome, "devsync", "sync", "manifest.json"),
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "directory",
              localPath: { default: "~/.ssh" },
              mode: { default: "normal" },
              permission: { default: "0600" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await pushSync({ dryRun: false }, environment);
    await rm(sshDirectory, { force: true, recursive: true });
    await pullSync({ dryRun: false }, environment);

    expect(await readFile(keyFile, "utf8")).toBe("fake-private-key\n");
    expect(await readFile(configFile, "utf8")).toBe(
      "Host *\n  AddKeysToAgent yes\n",
    );

    const keyStats = await lstat(keyFile);
    expect(keyStats.mode & 0o777).toBe(0o600);

    const configStats = await lstat(configFile);
    expect(configStats.mode & 0o777).toBe(0o600);
  });

  it("uses default executable mode when permission is not set", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();
    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    await trackSyncTarget(
      { mode: "normal", target: gitconfig },
      environment,
      homeDirectory,
    );

    await pushSync({ dryRun: false }, environment);
    await rm(gitconfig);
    await pullSync({ dryRun: false }, environment);

    const stats = await lstat(gitconfig);
    expect(stats.mode & 0o777).toBe(0o644);
  });

  it("preserves permission field in manifest through round-trip", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const keyFile = join(homeDirectory, ".ssh", "id_rsa");
    const ageKeys = await createAgeKeyPair();
    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(join(homeDirectory, ".ssh"), { recursive: true });
    await writeFile(keyFile, "key-content\n");

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    const manifestPath = join(
      xdgConfigHome,
      "devsync",
      "sync",
      "manifest.json",
    );
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          version: 7,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.ssh/id_rsa" },
              mode: { default: "secret" },
              permission: { default: "0600" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await pushSync({ dryRun: false }, environment);

    const config = JSON.parse(await readFile(manifestPath, "utf8")) as {
      entries: Array<{
        permission?: { default: string };
      }>;
    };

    expect(config.entries[0]?.permission).toEqual({ default: "0600" });
  });

  it("assigns and unassigns profiles to entries", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    const environment = createSyncEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );
    await trackSyncTarget(
      { mode: "normal", target: gitconfig },
      environment,
      cwd,
    );

    const assignResult = await assignSyncProfiles(
      {
        target: gitconfig,
        profiles: ["default", "work"],
      },
      environment,
      cwd,
    );

    expect(assignResult.action).toBe("assigned");
    expect(assignResult.profiles).toEqual(["default", "work"]);

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ profiles?: string[] }> };

    expect(config.entries[0]?.profiles).toEqual(["default", "work"]);

    const listResult = await listSyncProfiles(environment);

    expect(listResult.availableProfiles).toEqual(["default", "work"]);
    expect(listResult.assignments).toEqual([
      {
        entryLocalPath: gitconfig,
        entryRepoPath: ".gitconfig",
        profiles: ["default", "work"],
      },
    ]);

    const reassignResult = await assignSyncProfiles(
      { target: gitconfig, profiles: ["default"] },
      environment,
      cwd,
    );

    expect(reassignResult.action).toBe("assigned");
    expect(reassignResult.profiles).toEqual(["default"]);

    const clearResult = await assignSyncProfiles(
      { target: gitconfig, profiles: [] },
      environment,
      cwd,
    );

    expect(clearResult.action).toBe("assigned");
    expect(clearResult.profiles).toEqual([]);

    const configAfter = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "manifest.json"),
        "utf8",
      ),
    ) as { entries: Array<{ profiles?: string[] }> };

    expect(configAfter.entries[0]?.profiles).toBeUndefined();
  });
});
