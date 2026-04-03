import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  HOME: "",
  XDG_CONFIG_HOME: "",
  WSL_DISTRO_NAME: undefined as string | undefined,
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

import * as platformConfig from "#app/config/platform.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";
import { initializeSyncDirectory } from "./init.ts";
import {
  assignProfiles,
  clearActiveProfile,
  listProfiles,
  setActiveProfile,
} from "./profile.ts";
import { pullChanges } from "./pull.ts";
import { pushChanges } from "./push.ts";
import { setTargetMode } from "./set.ts";
import { trackTarget } from "./track.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-sync-test-");

  temporaryDirectories.push(directory);

  return directory;
};

const setEnvironment = (homeDirectory: string, xdgConfigHome: string) => {
  mockEnv.HOME = homeDirectory;
  mockEnv.XDG_CONFIG_HOME = xdgConfigHome;
};

afterEach(async () => {
  vi.restoreAllMocks();
  mockEnv.HOME = "";
  mockEnv.XDG_CONFIG_HOME = "";
  mockEnv.WSL_DISTRO_NAME = undefined;

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("sync service", () => {
  it("tracks entries in v7 config format", async () => {
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

    setEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await trackTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      cwd,
    );
    await trackTarget(
      {
        mode: "secret",
        target: workFile,
      },
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
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

  it("tracks explicit repoPath values and syncs through them", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await trackTarget(
      {
        mode: "normal",
        repoPath: "profiles/shared/git/main.conf",
        target: gitconfig,
      },
      homeDirectory,
    );

    const manifestPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "manifest.jsonc",
    );
    const config = JSON.parse(await readFile(manifestPath, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };

    expect(config.entries).toEqual([
      {
        kind: "file",
        localPath: { default: "~/.gitconfig" },
        repoPath: { default: "profiles/shared/git/main.conf" },
        mode: { default: "normal" },
      },
    ]);

    await pushChanges({ dryRun: false });

    const artifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      "profiles",
      "shared",
      "git",
      "main.conf",
    );

    expect(await readFile(artifactPath, "utf8")).toContain("name=test");

    await writeFile(gitconfig, "[user]\nname=changed\n");
    await pullChanges({ dryRun: false });

    expect(await readFile(gitconfig, "utf8")).toBe("[user]\nname=test\n");
  });

  it("updates repoPath when re-tracking an existing entry", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: gitconfig,
      },
      homeDirectory,
    );

    const result = await trackTarget(
      {
        mode: "normal",
        repoPath: "profiles/shared/git/main.conf",
        target: gitconfig,
      },
      homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.repoPath).toBe("profiles/shared/git/main.conf");

    await pushChanges({ dryRun: false });

    const updatedArtifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      "profiles",
      "shared",
      "git",
      "main.conf",
    );
    const originalArtifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".gitconfig",
    );

    expect(await readFile(updatedArtifactPath, "utf8")).toContain("name=test");
    await expect(readFile(originalArtifactPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("collapses redundant WSL mode overrides when tracking an existing root", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "mytool");
    const ageKeys = await createAgeKeyPair();
    setEnvironment(homeDirectory, xdgConfigHome);
    mockEnv.WSL_DISTRO_NAME = "Ubuntu";
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
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

    const result = await trackTarget(
      {
        mode: "secret",
        target: bundleDirectory,
      },
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
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

    setEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: sharedDirectory,
      },
      cwd,
    );
    await setTargetMode(
      {
        mode: "secret",
        target: join(sharedDirectory, "secrets.zsh"),
      },
      cwd,
    );

    expect(await setActiveProfile("work")).toMatchObject({
      action: "use",
      activeProfile: "work",
      profile: "work",
    });
    expect(await clearActiveProfile()).toMatchObject({
      action: "clear",
    });
  });

  it("stores child overrides under explicit parent repo paths", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const publicFile = join(appDirectory, "public.txt");
    const secretFile = join(appDirectory, "secret.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(publicFile, "public\n");
    await writeFile(secretFile, "secret\n");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        repoPath: "profiles/shared/app",
        target: appDirectory,
      },
      homeDirectory,
    );
    await setTargetMode(
      {
        mode: "secret",
        target: secretFile,
      },
      homeDirectory,
    );

    const manifestPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "manifest.jsonc",
    );
    const config = JSON.parse(await readFile(manifestPath, "utf8")) as {
      entries: Array<{
        kind: string;
        localPath: { default: string };
        mode?: { default: string };
        repoPath?: { default: string };
      }>;
    };

    expect(config.entries).toEqual([
      {
        kind: "directory",
        localPath: { default: "~/.config/app" },
        repoPath: { default: "profiles/shared/app" },
        mode: { default: "normal" },
      },
      {
        kind: "file",
        localPath: { default: "~/.config/app/secret.txt" },
        repoPath: { default: "profiles/shared/app/secret.txt" },
        mode: { default: "secret" },
      },
    ]);

    await pushChanges({ dryRun: false });

    const publicArtifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      "profiles",
      "shared",
      "app",
      "public.txt",
    );
    const secretArtifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      "profiles",
      "shared",
      "app",
      "secret.txt.devsync.secret",
    );

    expect(await readFile(publicArtifactPath, "utf8")).toBe("public\n");
    expect(await readFile(secretArtifactPath, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );
  });

  it("collapses redundant WSL mode overrides when updating an existing entry mode", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();
    setEnvironment(homeDirectory, xdgConfigHome);
    mockEnv.WSL_DISTRO_NAME = "Ubuntu";
    const cwd = homeDirectory;

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
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

    const result = await setTargetMode(
      {
        mode: "secret",
        target: gitconfig,
      },
      cwd,
    );

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
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

    setEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: zshDirectory,
      },
      cwd,
    );
    await setTargetMode(
      {
        mode: "secret",
        target: secretsFile,
      },
      cwd,
    );

    await pushChanges({
      dryRun: false,
    });

    const sharedArtifact = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "zsh",
      "zshrc",
    );
    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "repository",
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
    await pullChanges({
      dryRun: false,
    });

    expect(await readFile(secretsFile, "utf8")).toContain("TOKEN=work");

    await setTargetMode(
      {
        mode: "normal",
        target: secretsFile,
      },
      cwd,
    );

    const configAfterModeChange = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
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
    setEnvironment(homeDirectory, xdgConfigHome);
    const platformSpy = vi.spyOn(platformConfig, "detectCurrentPlatformKey");

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=linux\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
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
    await pushChanges({
      dryRun: false,
    });

    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "repository",
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
      pullChanges({
        dryRun: false,
      }),
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
    setEnvironment(homeDirectory, xdgConfigHome);
    const platformSpy = vi.spyOn(platformConfig, "detectCurrentPlatformKey");

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=linux\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
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
    await pushChanges({
      dryRun: false,
    });

    const secretArtifact = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "zsh",
      "secrets.zsh.devsync.secret",
    );
    expect(await readFile(secretArtifact, "utf8")).toContain(
      "BEGIN AGE ENCRYPTED FILE",
    );

    platformSpy.mockReturnValue("win");
    const result = await pushChanges({
      dryRun: false,
    });

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
    setEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(keyFile, "fake-private-key\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
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

    await pushChanges({ dryRun: false });
    await writeFile(keyFile, "modified-content\n");
    await pullChanges({ dryRun: false });

    expect(await readFile(keyFile, "utf8")).toBe("fake-private-key\n");
    const stats = await lstat(keyFile);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("restores directory entry permission to child files and a searchable directory on pull", async () => {
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
    setEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(keyFile, "fake-private-key\n");
    await writeFile(configFile, "Host *\n  AddKeysToAgent yes\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
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

    await pushChanges({ dryRun: false });
    await rm(sshDirectory, { force: true, recursive: true });
    await pullChanges({ dryRun: false });

    expect(await readFile(keyFile, "utf8")).toBe("fake-private-key\n");
    expect(await readFile(configFile, "utf8")).toBe(
      "Host *\n  AddKeysToAgent yes\n",
    );

    const directoryStats = await lstat(sshDirectory);
    expect(directoryStats.mode & 0o777).toBe(0o700);

    const keyStats = await lstat(keyFile);
    expect(keyStats.mode & 0o777).toBe(0o600);

    const configStats = await lstat(configFile);
    expect(configStats.mode & 0o777).toBe(0o600);
  });

  it("preserves ignored local files inside permissioned directories on pull", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sshDirectory = join(homeDirectory, ".ssh");
    const keyFile = join(sshDirectory, "id_rsa");
    const ignoredFile = join(sshDirectory, "known_hosts.local");
    const ageKeys = await createAgeKeyPair();
    setEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(keyFile, "fake-private-key\n");
    await writeFile(ignoredFile, "initial-local-state\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await writeFile(
      join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
      JSON.stringify(
        {
          version: 7,
          age: {
            recipients: [ageKeys.recipient],
          },
          entries: [
            {
              kind: "directory",
              localPath: { default: "~/.ssh" },
              mode: { default: "normal" },
              permission: { default: "0600" },
            },
            {
              kind: "file",
              localPath: { default: "~/.ssh/known_hosts.local" },
              mode: { default: "ignore" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    await pushChanges({ dryRun: false });
    await writeFile(keyFile, "modified-content\n");
    await writeFile(ignoredFile, "preserved-local-state\n");
    await pullChanges({ dryRun: false });

    expect(await readFile(keyFile, "utf8")).toBe("fake-private-key\n");
    expect(await readFile(ignoredFile, "utf8")).toBe("preserved-local-state\n");

    const directoryStats = await lstat(sshDirectory);
    expect(directoryStats.mode & 0o777).toBe(0o700);

    const keyStats = await lstat(keyFile);
    expect(keyStats.mode & 0o777).toBe(0o600);
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
    setEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await trackTarget({ mode: "normal", target: gitconfig }, homeDirectory);

    await pushChanges({ dryRun: false });
    await rm(gitconfig);
    await pullChanges({ dryRun: false });

    const stats = await lstat(gitconfig);
    expect(stats.mode & 0o777).toBe(0o644);
  });

  it("preserves permission field in config through round-trip", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const keyFile = join(homeDirectory, ".ssh", "id_rsa");
    const ageKeys = await createAgeKeyPair();
    setEnvironment(homeDirectory, xdgConfigHome);

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(join(homeDirectory, ".ssh"), { recursive: true });
    await writeFile(keyFile, "key-content\n");

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    const manifestPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "manifest.jsonc",
    );
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          version: 7,
          age: {
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

    await pushChanges({ dryRun: false });

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

    setEnvironment(homeDirectory, xdgConfigHome);
    const cwd = homeDirectory;

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: gitconfig }, cwd);

    const assignResult = await assignProfiles(
      {
        target: gitconfig,
        profiles: ["default", "work"],
      },
      cwd,
    );

    expect(assignResult.action).toBe("assigned");
    expect(assignResult.profiles).toEqual(["default", "work"]);

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
        "utf8",
      ),
    ) as { entries: Array<{ profiles?: string[] }> };

    expect(config.entries[0]?.profiles).toEqual(["default", "work"]);

    const listResult = await listProfiles();

    expect(listResult.availableProfiles).toEqual(["default", "work"]);
    expect(listResult.assignments).toEqual([
      {
        entryLocalPath: gitconfig,
        entryRepoPath: ".gitconfig",
        profiles: ["default", "work"],
      },
    ]);

    const reassignResult = await assignProfiles(
      { target: gitconfig, profiles: ["default"] },
      cwd,
    );

    expect(reassignResult.action).toBe("assigned");
    expect(reassignResult.profiles).toEqual(["default"]);

    const clearResult = await assignProfiles(
      { target: gitconfig, profiles: [] },
      cwd,
    );

    expect(clearResult.action).toBe("assigned");
    expect(clearResult.profiles).toEqual([]);

    const configAfter = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "repository", "manifest.jsonc"),
        "utf8",
      ),
    ) as { entries: Array<{ profiles?: string[] }> };

    expect(configAfter.entries[0]?.profiles).toBeUndefined();
  });
});
