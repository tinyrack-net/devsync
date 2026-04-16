import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSymlink } from "#app/lib/filesystem.ts";

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
  runGit,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";
import { initializeSyncDirectory } from "./init.ts";
import {
  assignProfiles,
  clearActiveProfile,
  listProfiles,
  setActiveProfile,
} from "./profile.ts";
import { preparePull, pullChanges } from "./pull.ts";
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

  it("keeps repository artifact bytes stable under core.autocrlf before repeated pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n");

    setEnvironment(homeDirectory, xdgConfigHome);

    const { syncDirectory } = await initializeSyncDirectory({
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
    await pushChanges({ dryRun: false });

    const artifactPath = join(syncDirectory, "default", ".gitconfig");

    await runGit(["add", "."], syncDirectory);
    await runGit(["commit", "-m", "store artifacts"], syncDirectory);
    await runGit(["config", "core.autocrlf", "true"], syncDirectory);

    await rm(artifactPath);
    await runGit(["checkout", "--", "default/.gitconfig"], syncDirectory);

    expect(await readFile(join(syncDirectory, ".gitattributes"), "utf8")).toBe(
      "* -text\n",
    );
    expect(await readFile(artifactPath, "utf8")).toBe("[user]\nname=test\n");

    await writeFile(gitconfig, "[user]\nname=changed\n");

    await pullChanges({ dryRun: false });
    const secondPull = await preparePull({ dryRun: true });

    expect(await readFile(gitconfig, "utf8")).toBe("[user]\nname=test\n");
    expect(secondPull.plan.updatedLocalPaths).toEqual([]);
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

  it("pull updates only changed files without replacing the tracked directory", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "myapp");
    const configFile = join(appDirectory, "config.json");
    const settingsFile = join(appDirectory, "settings.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(configFile, '{"version":1}\n', "utf8");
    await writeFile(settingsFile, '{"theme":"dark"}\n', "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget(
      {
        mode: "normal",
        target: appDirectory,
      },
      homeDirectory,
    );

    await pushChanges({ dryRun: false });

    const localDirectoryBefore = await lstat(appDirectory);
    const localConfigBefore = await lstat(configFile);
    const repoSettingsFile = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "myapp",
      "settings.json",
    );

    await writeFile(repoSettingsFile, '{"theme":"light"}\n', "utf8");
    await pullChanges({ dryRun: false });

    const localDirectoryAfter = await lstat(appDirectory);
    const localConfigAfter = await lstat(configFile);

    expect(localDirectoryAfter.ino).toBe(localDirectoryBefore.ino);
    expect(localConfigAfter.ino).toBe(localConfigBefore.ino);
    expect(await readFile(configFile, "utf8")).toBe('{"version":1}\n');
    expect(await readFile(settingsFile, "utf8")).toBe('{"theme":"light"}\n');
  });

  it("pull reconciles nested directories without recreating unchanged ancestors", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "myapp");
    const themesDirectory = join(appDirectory, "themes");
    const nestedThemeFile = join(themesDirectory, "dark.json");
    const siblingFile = join(appDirectory, "settings.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(themesDirectory, { recursive: true });
    await writeFile(nestedThemeFile, '{"accent":"blue"}\n', "utf8");
    await writeFile(siblingFile, '{"font":"mono"}\n', "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: appDirectory }, homeDirectory);

    await pushChanges({ dryRun: false });

    const appDirectoryBefore = await lstat(appDirectory);
    const themesDirectoryBefore = await lstat(themesDirectory);
    const siblingFileBefore = await lstat(siblingFile);
    const repoNestedThemeFile = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "myapp",
      "themes",
      "dark.json",
    );

    await writeFile(repoNestedThemeFile, '{"accent":"amber"}\n', "utf8");
    await pullChanges({ dryRun: false });

    const appDirectoryAfter = await lstat(appDirectory);
    const themesDirectoryAfter = await lstat(themesDirectory);
    const siblingFileAfter = await lstat(siblingFile);

    expect(appDirectoryAfter.ino).toBe(appDirectoryBefore.ino);
    expect(themesDirectoryAfter.ino).toBe(themesDirectoryBefore.ino);
    expect(siblingFileAfter.ino).toBe(siblingFileBefore.ino);
    expect(await readFile(nestedThemeFile, "utf8")).toBe(
      '{"accent":"amber"}\n',
    );
    expect(await readFile(siblingFile, "utf8")).toBe('{"font":"mono"}\n');
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

  it("deletes local files that were removed from repository during pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "myapp");
    const fileA = join(appDirectory, "config.json");
    const fileB = join(appDirectory, "settings.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(fileA, '{"key": "value"}\n', "utf8");
    await writeFile(fileB, '{"setting": "value"}\n', "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await trackTarget(
      {
        mode: "normal",
        target: appDirectory,
      },
      homeDirectory,
    );

    await pushChanges({ dryRun: false });

    const repoPathA = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "myapp",
      "config.json",
    );
    const repoPathB = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "myapp",
      "settings.json",
    );

    expect(await readFile(repoPathA, "utf8")).toContain('"key": "value"');
    expect(await readFile(repoPathB, "utf8")).toContain('"setting": "value"');

    await rm(repoPathB);

    await pullChanges({ dryRun: false });

    expect(await readFile(fileA, "utf8")).toContain('"key": "value"');
    await expect(readFile(fileB, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("deletes local files when entire tracked directory is removed from repository", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sshDirectory = join(homeDirectory, ".ssh");
    const keyFile = join(sshDirectory, "id_rsa");
    const configFile = join(sshDirectory, "config");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(keyFile, "fake-private-key\n", "utf8");
    await writeFile(configFile, "Host *\n  AddKeysToAgent yes\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await trackTarget(
      {
        mode: "normal",
        target: sshDirectory,
      },
      homeDirectory,
    );

    await pushChanges({ dryRun: false });

    const repoSshDir = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".ssh",
    );

    expect(await readFile(join(repoSshDir, "id_rsa"), "utf8")).toContain(
      "fake-private-key",
    );

    await rm(repoSshDir, { force: true, recursive: true });

    const result = await pullChanges({ dryRun: false });

    expect(result.deletedLocalCount).toBeGreaterThanOrEqual(1);
    await expect(readFile(keyFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(configFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("prunes stale empty managed directories during pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "bundle");
    const cacheDirectory = join(appDirectory, "cache");
    const cacheFile = join(cacheDirectory, "old.txt");
    const keepFile = join(appDirectory, "keep.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cacheFile, "old\n", "utf8");
    await writeFile(keepFile, "keep\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: appDirectory }, homeDirectory);

    await pushChanges({ dryRun: false });

    const repoCacheFile = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "bundle",
      "cache",
      "old.txt",
    );
    const repoCacheDirectory = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "bundle",
      "cache",
    );
    await rm(repoCacheFile);
    await rm(repoCacheDirectory, { force: true, recursive: true });

    await pullChanges({ dryRun: false });

    await expect(readFile(cacheFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(lstat(cacheDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(keepFile, "utf8")).toBe("keep\n");
  });

  it("pull replaces a tracked file with a directory when the repository type changes", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const currentPath = join(appDirectory, "current");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(currentPath, "v1\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: appDirectory }, homeDirectory);

    await pushChanges({ dryRun: false });

    const repoCurrentPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "app",
      "current",
    );

    await rm(repoCurrentPath);
    await mkdir(repoCurrentPath, { recursive: true });
    await writeFile(join(repoCurrentPath, "index.txt"), "v2\n", "utf8");

    await pullChanges({ dryRun: false });

    const currentStats = await lstat(currentPath);
    expect(currentStats.isDirectory()).toBe(true);
    expect(await readFile(join(currentPath, "index.txt"), "utf8")).toBe("v2\n");
  });

  it("pull replaces a tracked symlink with a file when the repository type changes", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const targetFile = join(appDirectory, "target.txt");
    const currentPath = join(appDirectory, "current");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(targetFile, "target\n", "utf8");
    await createSymlink("./target.txt", currentPath);

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: appDirectory }, homeDirectory);

    await pushChanges({ dryRun: false });

    const repoCurrentPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "app",
      "current",
    );

    await rm(repoCurrentPath);
    await writeFile(repoCurrentPath, "plain\n", "utf8");

    await pullChanges({ dryRun: false });

    const currentStats = await lstat(currentPath);
    expect(currentStats.isFile()).toBe(true);
    expect(await readFile(currentPath, "utf8")).toBe("plain\n");
  });

  it("reports deleted local count in pull result", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, ".config", "bundle");
    const file1 = join(bundleDirectory, "file1.txt");
    const file2 = join(bundleDirectory, "file2.txt");
    const file3 = join(bundleDirectory, "file3.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(file1, "content1\n", "utf8");
    await writeFile(file2, "content2\n", "utf8");
    await writeFile(file3, "content3\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await trackTarget(
      {
        mode: "normal",
        target: bundleDirectory,
      },
      homeDirectory,
    );

    await pushChanges({ dryRun: false });

    const repoFile2 = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "bundle",
      "file2.txt",
    );
    const repoFile3 = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".config",
      "bundle",
      "file3.txt",
    );

    await rm(repoFile2);
    await rm(repoFile3);

    const result = await pullChanges({ dryRun: false });

    expect(result.deletedLocalCount).toBe(2);
    expect(await readFile(file1, "utf8")).toBe("content1\n");
    await expect(readFile(file2, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(file3, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips rewriting unchanged plain artifacts on push", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const gitconfig = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(gitconfig, "[user]\nname=test\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: gitconfig }, homeDirectory);

    await pushChanges({ dryRun: false });

    const artifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".gitconfig",
    );
    const beforeStats = await lstat(artifactPath);

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await pushChanges({ dryRun: false });

    const afterStats = await lstat(artifactPath);

    expect(afterStats.mtimeMs).toBe(beforeStats.mtimeMs);
    expect(await readFile(artifactPath, "utf8")).toBe("[user]\nname=test\n");
  });

  it("skips recreating unchanged symlink artifacts on push", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshenv = join(homeDirectory, ".zshenv");
    const zshrc = join(homeDirectory, ".zshrc");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(zshrc, "export PATH=~/.local/bin:$PATH\n", "utf8");
    await createSymlink(".zshrc", zshenv);

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: zshenv }, homeDirectory);

    await pushChanges({ dryRun: false });

    const artifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      ".zshenv",
    );
    const beforeStats = await lstat(artifactPath);

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await pushChanges({ dryRun: false });

    const afterStats = await lstat(artifactPath);

    expect(afterStats.ino).toBe(beforeStats.ino);
    expect(await readlink(artifactPath)).toBe(".zshrc");
  });

  it("updates repository artifacts when only the executable bit changes", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const scriptPath = join(homeDirectory, "bin", "hello.sh");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(join(homeDirectory, "bin"), { recursive: true });
    await writeFile(scriptPath, "#!/bin/sh\necho hello\n", "utf8");
    await chmod(scriptPath, 0o644);

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await trackTarget({ mode: "normal", target: scriptPath }, homeDirectory);

    await pushChanges({ dryRun: false });

    const artifactPath = join(
      xdgConfigHome,
      "devsync",
      "repository",
      "default",
      "bin",
      "hello.sh",
    );

    expect((await lstat(artifactPath)).mode & 0o777).toBe(0o644);

    await chmod(scriptPath, 0o755);
    await pushChanges({ dryRun: false });

    expect((await lstat(artifactPath)).mode & 0o777).toBe(0o755);
    expect(await readFile(artifactPath, "utf8")).toBe(
      "#!/bin/sh\necho hello\n",
    );
  });
});
