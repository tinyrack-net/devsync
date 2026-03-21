import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncSecretArtifactSuffix } from "#app/config/sync.ts";
import { addSyncTarget } from "#app/services/add.ts";
import { runSyncDoctor } from "#app/services/doctor.ts";
import { forgetSyncTarget } from "#app/services/forget.ts";
import { initializeSync } from "#app/services/init.ts";
import { listSyncConfig } from "#app/services/list.ts";
import {
  activateSyncProfile,
  clearSyncProfiles,
  deactivateSyncProfile,
  listSyncProfiles,
  useSyncProfile,
} from "#app/services/profile.ts";
import { pullSync } from "#app/services/pull.ts";
import { pushSync } from "#app/services/push.ts";
import { createSyncContext } from "#app/services/runtime.ts";
import { setSyncTargetMode } from "#app/services/set.ts";
import { getSyncStatus } from "#app/services/status.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";

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
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("sync service", () => {
  it("generates a default local age identity when init flags are omitted", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    const result = await initializeSync(
      {
        recipients: [],
      },
      context,
    );
    const config = JSON.parse(
      await readFile(join(result.syncDirectory, "config.json"), "utf8"),
    ) as {
      age: {
        identityFile: string;
        recipients: string[];
      };
    };

    expect(result.generatedIdentity).toBe(true);
    expect(result.identityFile).toBe(
      join(xdgConfigHome, "devsync", "age", "keys.txt"),
    );
    expect(config.age.identityFile).toBe(
      "$XDG_CONFIG_HOME/devsync/age/keys.txt",
    );
    expect(config.age.recipients).toHaveLength(1);
    expect(
      await readFile(join(xdgConfigHome, "devsync", "age", "keys.txt"), "utf8"),
    ).toContain("AGE-SECRET-KEY-");
  });

  it("initializes the sync repository inside the XDG config path", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const result = await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );

    expect(result.syncDirectory).toBe(join(xdgConfigHome, "devsync", "sync"));
    expect(result.gitAction).toBe("initialized");
    expect(
      await readFile(join(result.syncDirectory, "config.json"), "utf8"),
    ).toContain("$XDG_CONFIG_HOME/devsync/age/keys.txt");

    const gitResult = await runGit(
      ["-C", result.syncDirectory, "rev-parse", "--is-inside-work-tree"],
      workspace,
    );

    expect(gitResult.stdout.trim()).toBe("true");
  });
  it("adds tracked entries and stores default modes instead of glob fields", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const settingsDirectory = join(homeDirectory, ".config", "mytool");
    const settingsFile = join(settingsDirectory, "settings.json");
    const secretsDirectory = join(settingsDirectory, "secrets");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(secretsDirectory, { recursive: true });
    await writeFile(settingsFile, "{}\n");
    await writeFile(join(secretsDirectory, "token.txt"), "secret\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );

    const fileAddResult = await addSyncTarget(
      {
        secret: false,
        target: settingsFile,
      },
      context,
    );
    const repeatFileAddResult = await addSyncTarget(
      {
        secret: true,
        target: settingsFile,
      },
      context,
    );
    const directoryAddResult = await addSyncTarget(
      {
        secret: true,
        target: secretsDirectory,
      },
      context,
    );
    const config = JSON.parse(
      await readFile(join(initResult.syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: Array<{
        kind: string;
        localPath: string;
        mode: string;
        overrides?: Record<string, string>;
        repoPath: string;
      }>;
    };

    expect(fileAddResult.alreadyTracked).toBe(false);
    expect(fileAddResult.mode).toBe("normal");
    expect(fileAddResult.repoPath).toBe(".config/mytool/settings.json");
    expect(fileAddResult.localPath).toBe(settingsFile);
    expect(repeatFileAddResult.alreadyTracked).toBe(true);
    expect(repeatFileAddResult.mode).toBe("secret");
    expect(directoryAddResult.repoPath).toBe(".config/mytool/secrets");
    expect(directoryAddResult.mode).toBe("secret");
    expect(config.entries).toEqual([
      {
        kind: "directory",
        localPath: "~/.config/mytool/secrets",
        mode: "secret",
        repoPath: ".config/mytool/secrets",
      },
      {
        kind: "file",
        localPath: "~/.config/mytool/settings.json",
        mode: "secret",
        repoPath: ".config/mytool/settings.json",
      },
    ]);
    expect("ignoreGlobs" in config).toBe(false);
    expect("secretGlobs" in config).toBe(false);
  });

  it("explains conflicting add targets with requested and existing paths", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const nestedFile = join(bundleDirectory, "token.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(nestedFile, "secret\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );

    await expect(
      addSyncTarget(
        {
          secret: false,
          target: nestedFile,
        },
        context,
      ),
    ).rejects.toThrowError(/conflicts with an existing tracked entry/u);
  });

  it("sets exact rules, subtree rules, and removes redundant normal overrides", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const publicFile = join(bundleDirectory, "private", "public.json");
    const cacheDirectory = join(bundleDirectory, "cache");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(join(bundleDirectory, "private"), { recursive: true });
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(publicFile, "{}\n");
    await writeFile(join(cacheDirectory, "state.txt"), "cache\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: true,
        target: bundleDirectory,
      },
      context,
    );

    const exactAdd = await setSyncTargetMode(
      {
        recursive: false,
        state: "normal",
        target: publicFile,
      },
      context,
    );
    const subtreeAdd = await setSyncTargetMode(
      {
        recursive: true,
        state: "ignore",
        target: cacheDirectory,
      },
      context,
    );
    const rootUpdate = await setSyncTargetMode(
      {
        recursive: true,
        state: "normal",
        target: bundleDirectory,
      },
      context,
    );
    const exactRemove = await setSyncTargetMode(
      {
        recursive: false,
        state: "normal",
        target: publicFile,
      },
      context,
    );
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        overrides?: Record<string, string>;
      }>;
    };

    expect(exactAdd.action).toBe("added");
    expect(exactAdd.scope).toBe("exact");
    expect(subtreeAdd.action).toBe("added");
    expect(subtreeAdd.scope).toBe("subtree");
    expect(rootUpdate.action).toBe("updated");
    expect(rootUpdate.scope).toBe("default");
    expect(exactRemove.action).toBe("removed");
    expect(config.entries).toHaveLength(1);
    expect(config.entries).toMatchObject([
      {
        kind: "directory",
        localPath: "~/bundle",
        overrides: { "cache/": "ignore" },
        repoPath: "bundle",
      },
    ]);
  });

  it("resolves bare relative sync set targets from the current working directory", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sshDirectory = join(homeDirectory, ".ssh");
    const knownHostsFile = join(sshDirectory, "known_hosts");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(sshDirectory, { recursive: true });
    await writeFile(knownHostsFile, "github.com ssh-ed25519 AAAA...\n");

    const context = createSyncContext({
      cwd: sshDirectory,
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: true,
        target: sshDirectory,
      },
      context,
    );

    const result = await setSyncTargetMode(
      {
        recursive: false,
        state: "ignore",
        target: "known_hosts",
      },
      context,
    );
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        repoPath: string;
        overrides?: Record<string, string>;
      }>;
    };

    expect(result.entryRepoPath).toBe(".ssh");
    expect(result.localPath).toBe(knownHostsFile);
    expect(result.repoPath).toBe(".ssh/known_hosts");
    expect(result.scope).toBe("exact");
    expect(config.entries).toMatchObject([
      {
        repoPath: ".ssh",
        overrides: { known_hosts: "ignore" },
      },
    ]);
  });

  it("forgets tracked entries and removes repository artifacts", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const settingsDirectory = join(homeDirectory, "mytool");
    const settingsFile = join(settingsDirectory, "settings.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsFile, "{}\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );

    await addSyncTarget(
      {
        secret: true,
        target: settingsFile,
      },
      context,
    );
    await mkdir(join(initResult.syncDirectory, "default", "mytool"), {
      recursive: true,
    });
    await writeFile(
      join(initResult.syncDirectory, "default", "mytool", "settings.json"),
      "stale plain copy\n",
    );
    await writeFile(
      join(
        initResult.syncDirectory,
        "default",
        "mytool",
        `settings.json${syncSecretArtifactSuffix}`,
      ),
      "stale encrypted copy\n",
    );

    const forgetResult = await forgetSyncTarget(
      {
        target: "mytool/settings.json",
      },
      context,
    );
    const config = JSON.parse(
      await readFile(join(initResult.syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: unknown[];
    };

    expect(forgetResult.repoPath).toBe("mytool/settings.json");
    expect(forgetResult.plainArtifactCount).toBe(1);
    expect(forgetResult.secretArtifactCount).toBe(1);
    expect("secretGlobRemoved" in forgetResult).toBe(false);
    expect(config.entries).toEqual([]);
    await expect(
      readFile(
        join(initResult.syncDirectory, "default", "mytool", "settings.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          initResult.syncDirectory,
          "default",
          "mytool",
          `settings.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("forgets tracked file entries via explicit local paths", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const settingsDirectory = join(homeDirectory, "mytool");
    const settingsFile = join(settingsDirectory, "settings.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(settingsFile, "{}\n");

    const context = createSyncContext({
      cwd: settingsDirectory,
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: settingsFile,
      },
      context,
    );

    const forgetResult = await forgetSyncTarget(
      {
        target: "./settings.json",
      },
      context,
    );
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: unknown[];
    };

    expect(forgetResult.localPath).toBe(settingsFile);
    expect(forgetResult.repoPath).toBe("mytool/settings.json");
    expect(config.entries).toEqual([]);
  });

  it("pushes and pulls according to exact mode rules while preserving ignored files", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const plainFile = join(bundleDirectory, "plain.txt");
    const secretFile = join(bundleDirectory, "secret.json");
    const ignoredFile = join(bundleDirectory, "ignored.txt");
    const extraFile = join(bundleDirectory, "extra.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain value\n");
    await writeFile(secretFile, JSON.stringify({ token: "secret" }, null, 2));
    await writeFile(ignoredFile, "keep local\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        recursive: false,
        state: "secret",
        target: secretFile,
      },
      context,
    );
    await setSyncTargetMode(
      {
        recursive: false,
        state: "ignore",
        target: ignoredFile,
      },
      context,
    );

    const pushResult = await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(pushResult.plainFileCount).toBe(1);
    expect(pushResult.encryptedFileCount).toBe(1);
    expect(
      await readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "default",
          "bundle",
          "plain.txt",
        ),
        "utf8",
      ),
    ).toBe("plain value\n");
    await expect(
      readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "default",
          "bundle",
          "ignored.txt",
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "default",
          "bundle",
          `secret.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");

    await writeFile(plainFile, "wrong value\n");
    await writeFile(
      secretFile,
      JSON.stringify({ token: "wrong-secret" }, null, 2),
    );
    await writeFile(ignoredFile, "preserve this\n");
    await writeFile(extraFile, "delete me\n");

    const pullResult = await pullSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(pullResult.deletedLocalCount).toBeGreaterThanOrEqual(1);
    expect(await readFile(plainFile, "utf8")).toBe("plain value\n");
    expect(await readFile(secretFile, "utf8")).toBe(
      `${JSON.stringify({ token: "secret" }, null, 2)}`,
    );
    expect(await readFile(ignoredFile, "utf8")).toBe("preserve this\n");
    await expect(readFile(extraFile, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects directory targets without --recursive and updates tracked file entries", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const cacheDirectory = join(bundleDirectory, "cache");
    const trackedFile = join(homeDirectory, ".zshrc");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(join(cacheDirectory, "state.txt"), "cache\n");
    await writeFile(trackedFile, "export TEST=1\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: trackedFile,
      },
      context,
    );

    await expect(
      setSyncTargetMode(
        {
          recursive: false,
          state: "ignore",
          target: cacheDirectory,
        },
        context,
      ),
    ).rejects.toThrowError(/Directory targets require --recursive/u);
    await expect(
      setSyncTargetMode(
        {
          recursive: false,
          state: "secret",
          target: trackedFile,
        },
        context,
      ),
    ).resolves.toMatchObject({
      action: "updated",
      repoPath: ".zshrc",
      scope: "default",
    });
  });

  it("rejects profile-specific file root updates", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const trackedFile = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(trackedFile, "[user]\n  name = profile\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: trackedFile,
      },
      context,
    );

    await expect(
      setSyncTargetMode(
        {
          profile: "work",
          recursive: false,
          state: "secret",
          target: trackedFile,
        },
        context,
      ),
    ).rejects.toThrowError(/not supported for file entries/u);
  });

  it("supports repo-path sync set for missing descendants and reports update transitions", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const cacheDirectory = join(bundleDirectory, "cache");
    const missingLocalPath = join(bundleDirectory, "future.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(join(cacheDirectory, "state.txt"), "cache\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );

    const exactAdded = await setSyncTargetMode(
      {
        recursive: false,
        state: "secret",
        target: "bundle/future.txt",
      },
      context,
    );
    const exactUpdated = await setSyncTargetMode(
      {
        recursive: false,
        state: "ignore",
        target: "bundle/future.txt",
      },
      context,
    );
    const exactUnchanged = await setSyncTargetMode(
      {
        recursive: false,
        state: "ignore",
        target: "bundle/future.txt",
      },
      context,
    );
    const subtreeAdded = await setSyncTargetMode(
      {
        recursive: true,
        state: "ignore",
        target: cacheDirectory,
      },
      context,
    );
    const subtreeUpdated = await setSyncTargetMode(
      {
        recursive: true,
        state: "secret",
        target: "bundle/cache",
      },
      context,
    );
    const subtreeUnchanged = await setSyncTargetMode(
      {
        recursive: true,
        state: "secret",
        target: "bundle/cache",
      },
      context,
    );
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        overrides?: Record<string, string>;
      }>;
    };

    expect(exactAdded.action).toBe("added");
    expect(exactUpdated.action).toBe("updated");
    expect(exactUnchanged.action).toBe("unchanged");
    expect(subtreeAdded.action).toBe("added");
    expect(subtreeUpdated.action).toBe("updated");
    expect(subtreeUnchanged.action).toBe("unchanged");
    expect(config.entries[0]?.overrides).toEqual({
      "cache/": "secret",
      "future.txt": "ignore",
    });

    await expect(
      setSyncTargetMode(
        {
          recursive: false,
          state: "secret",
          target: missingLocalPath,
        },
        context,
      ),
    ).rejects.toThrowError(/does not exist/u);
    await expect(
      setSyncTargetMode(
        {
          recursive: false,
          state: "secret",
          target: bundleDirectory,
        },
        context,
      ),
    ).rejects.toThrowError(/require --recursive/u);
    await expect(
      setSyncTargetMode(
        {
          recursive: true,
          state: "secret",
          target: join(cacheDirectory, "state.txt"),
        },
        context,
      ),
    ).rejects.toThrowError(/can only be used with directories/u);
  });

  it("removes a profile-specific override when it falls back to the inherited mode", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const zshDirectory = join(homeDirectory, ".config", "zsh");
    const secretsFile = join(zshDirectory, "secrets.zsh");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(zshDirectory, { recursive: true });
    await writeFile(secretsFile, "export TOKEN=abc\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: zshDirectory,
      },
      context,
    );

    const baseRule = await setSyncTargetMode(
      {
        recursive: false,
        state: "secret",
        target: secretsFile,
      },
      context,
    );
    const profiledIgnore = await setSyncTargetMode(
      {
        profile: "vivident",
        recursive: false,
        state: "ignore",
        target: secretsFile,
      },
      context,
    );
    const profiledSecret = await setSyncTargetMode(
      {
        profile: "vivident",
        recursive: false,
        state: "secret",
        target: secretsFile,
      },
      context,
    );
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        overrides?: Record<string, string>;
        profiles?: {
          vivident?: { mode: string; overrides?: Record<string, string> };
        };
      }>;
    };

    expect(baseRule.action).toBe("added");
    expect(profiledIgnore.action).toBe("added");
    expect(profiledSecret.action).toBe("removed");
    expect(profiledSecret.reason).toBe("reverted-to-inherited");
    expect(config.entries[0]?.overrides).toEqual({ "secrets.zsh": "secret" });
    expect(config.entries[0]?.profiles?.vivident).toBeUndefined();
  });

  it("moves repository artifacts across normal, secret, and ignore mode transitions", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const tokenFile = join(bundleDirectory, "token.txt");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(tokenFile, "token-v1\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );

    const normalPush = await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(normalPush.plainFileCount).toBe(1);
    expect(
      await readFile(
        join(syncDirectory, "default", "bundle", "token.txt"),
        "utf8",
      ),
    ).toBe("token-v1\n");
    await expect(
      readFile(
        join(
          syncDirectory,
          "default",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    await setSyncTargetMode(
      {
        recursive: false,
        state: "secret",
        target: tokenFile,
      },
      context,
    );

    const secretPush = await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(secretPush.encryptedFileCount).toBe(1);
    await expect(
      readFile(join(syncDirectory, "default", "bundle", "token.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(
        join(
          syncDirectory,
          "default",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");

    await setSyncTargetMode(
      {
        recursive: false,
        state: "ignore",
        target: tokenFile,
      },
      context,
    );

    const ignorePush = await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(ignorePush.deletedArtifactCount).toBeGreaterThanOrEqual(1);
    await expect(
      readFile(join(syncDirectory, "default", "bundle", "token.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          syncDirectory,
          "default",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails pull when a tracked secret artifact is corrupted", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const tokenFile = join(bundleDirectory, "token.txt");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(tokenFile, "token-v1\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        recursive: false,
        state: "secret",
        target: tokenFile,
      },
      context,
    );
    await pushSync(
      {
        dryRun: false,
      },
      context,
    );
    await writeFile(
      join(
        syncDirectory,
        "default",
        "bundle",
        `token.txt${syncSecretArtifactSuffix}`,
      ),
      "not a valid age payload",
      "utf8",
    );

    await expect(
      pullSync(
        {
          dryRun: false,
        },
        context,
      ),
    ).rejects.toThrowError(/Failed to decrypt a secret repository artifact/u);
  });

  it("lists tracked entries with overrides", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const tokenFile = join(bundleDirectory, "token.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(tokenFile, "secret\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        recursive: false,
        state: "secret",
        target: tokenFile,
      },
      context,
    );

    const result = await listSyncConfig(context);

    expect(result.entries).toEqual([
      {
        active: true,
        kind: "directory",
        localPath: bundleDirectory,
        mode: "normal",
        name: "bundle",
        overrides: [{ mode: "secret", selector: "token.txt" }],
        repoPath: "bundle",
      },
    ]);
    expect(result.ruleCount).toBe(1);
  });

  it("builds status previews for push and pull plans", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const plainFile = join(bundleDirectory, "plain.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(plainFile, "plain\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: bundleDirectory,
      },
      context,
    );
    await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    const status = await getSyncStatus(context);

    expect(status.push.preview).toContain("bundle/plain.txt");
    expect(status.pull.preview).toContain("bundle/plain.txt");
    expect(status.push.plainFileCount).toBe(1);
    expect(status.pull.plainFileCount).toBe(1);
  });

  it("preserves artifacts from inactive profiles during push", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const devFile = join(appDirectory, "dev.json");
    const ageKeys = await createAgeKeyPair();
    const globalConfigPath = join(xdgConfigHome, "devsync", "config.json");
    const syncFilesDirectory = join(xdgConfigHome, "devsync", "sync");

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(devFile, '{"value":"work"}\n');

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: appDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        profile: "work",
        recursive: false,
        state: "secret",
        target: devFile,
      },
      context,
    );
    await setSyncTargetMode(
      {
        profile: "personal",
        recursive: false,
        state: "secret",
        target: devFile,
      },
      context,
    );

    await writeFile(
      globalConfigPath,
      JSON.stringify({ activeProfile: "work", version: 1 }, null, 2),
      "utf8",
    );

    await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(
      await readFile(
        join(
          syncFilesDirectory,
          "work",
          ".config",
          "app",
          `dev.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");
    await expect(
      readFile(
        join(
          syncFilesDirectory,
          "personal",
          ".config",
          "app",
          `dev.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(devFile, '{"value":"personal"}\n');
    await writeFile(
      globalConfigPath,
      JSON.stringify({ activeProfile: "personal", version: 1 }, null, 2),
      "utf8",
    );

    await pushSync(
      {
        dryRun: false,
      },
      context,
    );

    expect(
      await readFile(
        join(
          syncFilesDirectory,
          "work",
          ".config",
          "app",
          `dev.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");
    expect(
      await readFile(
        join(
          syncFilesDirectory,
          "personal",
          ".config",
          "app",
          `dev.json${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");
  });

  it("manages active profiles through the global config", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const devFile = join(appDirectory, "dev.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(devFile, '{"value":"x"}\n');

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: appDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        profile: "work",
        recursive: false,
        state: "secret",
        target: devFile,
      },
      context,
    );
    await setSyncTargetMode(
      {
        profile: "personal",
        recursive: false,
        state: "ignore",
        target: devFile,
      },
      context,
    );

    expect(await listSyncProfiles(context)).toMatchObject({
      activeProfilesMode: "none",
      availableProfiles: ["personal", "work"],
      globalConfigExists: false,
    });

    expect(await useSyncProfile("work", context)).toMatchObject({
      activeProfile: "work",
      mode: "use",
    });
    expect(await activateSyncProfile("personal", context)).toMatchObject({
      activeProfile: "work",
      mode: "activate",
      profile: "personal",
    });
    expect(await listSyncProfiles(context)).toMatchObject({
      activeProfile: "work",
      activeProfilesMode: "single",
      globalConfigExists: true,
    });
    expect(await deactivateSyncProfile("work", context)).toMatchObject({
      mode: "deactivate",
      profile: "work",
    });

    expect(await clearSyncProfiles(context)).toMatchObject({
      mode: "clear",
    });
    expect(await listSyncProfiles(context)).toMatchObject({
      activeProfilesMode: "none",
      globalConfigExists: true,
    });
  });

  it("supports profile-specific set and forget operations", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const tokenFile = join(appDirectory, "token.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(tokenFile, "secret\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: appDirectory,
      },
      context,
    );

    const setResult = await setSyncTargetMode(
      {
        profile: "work",
        recursive: false,
        state: "secret",
        target: ".config/app/token.txt",
      },
      context,
    );

    expect(setResult.profile).toBe("work");

    await setSyncTargetMode(
      {
        profile: "personal",
        recursive: false,
        state: "ignore",
        target: ".config/app/token.txt",
      },
      context,
    );

    const forgetResult = await forgetSyncTarget(
      {
        profile: "personal",
        target: appDirectory,
      },
      context,
    );

    expect(forgetResult.profile).toBe("personal");
    expect((await listSyncConfig(context)).entries).toHaveLength(2);
  });

  it("routes child overrides into profile namespaces", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const tokenFile = join(appDirectory, "token.txt");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(tokenFile, "token-work\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: appDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        profile: "work",
        recursive: false,
        state: "secret",
        target: tokenFile,
      },
      context,
    );
    await useSyncProfile("work", context);

    await pushSync({ dryRun: false }, context);

    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        profiles?: {
          work?: { overrides?: Record<string, string> };
        };
      }>;
    };

    expect(config.entries[0]?.profiles?.work).toEqual({
      overrides: {
        "token.txt": "secret",
      },
    });
    expect(
      await readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "work",
          ".config",
          "app",
          "token.txt.devsync.secret",
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");
  });

  it("shows profile-specific list and status details", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const appDirectory = join(homeDirectory, ".config", "app");
    const devFile = join(appDirectory, "dev.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(appDirectory, { recursive: true });
    await writeFile(devFile, '{"value":"x"}\n');

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: appDirectory,
      },
      context,
    );
    await setSyncTargetMode(
      {
        profile: "work",
        recursive: false,
        state: "secret",
        target: devFile,
      },
      context,
    );
    await useSyncProfile("work", context);

    const listResult = await listSyncConfig(context);
    const statusResult = await getSyncStatus(context);

    expect(
      listResult.entries.find((entry) => {
        return entry.profile === "work" && entry.repoPath === ".config/app";
      }),
    ).toMatchObject({
      active: true,
      profile: "work",
      repoPath: ".config/app",
    });
    expect(statusResult.activeProfile).toBe("work");
    expect(statusResult.activeProfilesMode).toBe("single");
  });

  it("reports doctor warnings for missing tracked local paths", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const trackedFile = join(homeDirectory, ".gitconfig");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(homeDirectory, { recursive: true });
    await writeFile(trackedFile, "[user]\n  name = test\n");

    const context = createSyncContext({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      context,
    );
    await addSyncTarget(
      {
        secret: false,
        target: trackedFile,
      },
      context,
    );
    await rm(trackedFile);

    const result = await runSyncDoctor(context);

    expect(result.hasFailures).toBe(false);
    expect(result.hasWarnings).toBe(true);
    expect(result.checks).toContainEqual({
      detail: "1 tracked local path is missing.",
      level: "warn",
      name: "local-paths",
    });
  });
});
