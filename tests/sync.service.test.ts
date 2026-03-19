import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { syncSecretArtifactSuffix } from "#app/config/sync.ts";
import { createSyncManager, SyncError } from "#app/services/sync/index.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
} from "./helpers/sync-fixture.ts";

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

describe("createSyncManager", () => {
  it("generates a default local age identity when init flags are omitted", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    const result = await manager.init({
      recipients: [],
    });
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const result = await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    const fileAddResult = await manager.add({
      secret: false,
      target: settingsFile,
    });
    const repeatFileAddResult = await manager.add({
      secret: true,
      target: settingsFile,
    });
    const directoryAddResult = await manager.add({
      secret: true,
      target: secretsDirectory,
    });
    const config = JSON.parse(
      await readFile(join(initResult.syncDirectory, "config.json"), "utf8"),
    ) as {
      defaultMode?: string;
      entries: Array<{
        defaultMode?: string;
        kind: string;
        localPath: string;
        name: string;
        repoPath: string;
        rules?: unknown[];
      }>;
    };

    expect(fileAddResult.alreadyTracked).toBe(false);
    expect(fileAddResult.defaultMode).toBe("normal");
    expect(fileAddResult.repoPath).toBe(".config/mytool/settings.json");
    expect(fileAddResult.localPath).toBe(settingsFile);
    expect(repeatFileAddResult.alreadyTracked).toBe(true);
    expect(repeatFileAddResult.defaultMode).toBe("secret");
    expect(directoryAddResult.repoPath).toBe(".config/mytool/secrets");
    expect(directoryAddResult.defaultMode).toBe("secret");
    expect(config.entries).toEqual([
      {
        defaultMode: "secret",
        kind: "directory",
        localPath: "~/.config/mytool/secrets",
        name: ".config/mytool/secrets",
        repoPath: ".config/mytool/secrets",
      },
      {
        defaultMode: "secret",
        kind: "file",
        localPath: "~/.config/mytool/settings.json",
        name: ".config/mytool/settings.json",
        repoPath: ".config/mytool/settings.json",
      },
    ]);
    expect("ignoreGlobs" in config).toBe(false);
    expect("secretGlobs" in config).toBe(false);
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: true,
      target: bundleDirectory,
    });

    const exactAdd = await manager.set({
      recursive: false,
      state: "normal",
      target: publicFile,
    });
    const subtreeAdd = await manager.set({
      recursive: true,
      state: "ignore",
      target: cacheDirectory,
    });
    const rootUpdate = await manager.set({
      recursive: true,
      state: "normal",
      target: bundleDirectory,
    });
    const exactRemove = await manager.set({
      recursive: false,
      state: "normal",
      target: publicFile,
    });
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        defaultMode?: string;
        rules?: Array<{
          match: string;
          mode: string;
          path: string;
        }>;
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
        name: "bundle",
        repoPath: "bundle",
        rules: [
          {
            match: "subtree",
            mode: "ignore",
            path: "cache",
          },
        ],
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

    const manager = createSyncManager({
      cwd: sshDirectory,
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: true,
      target: sshDirectory,
    });

    const result = await manager.set({
      recursive: false,
      state: "ignore",
      target: "known_hosts",
    });
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        repoPath: string;
        rules?: Array<{
          match: string;
          mode: string;
          path: string;
        }>;
      }>;
    };

    expect(result.entryRepoPath).toBe(".ssh");
    expect(result.localPath).toBe(knownHostsFile);
    expect(result.repoPath).toBe(".ssh/known_hosts");
    expect(result.scope).toBe("exact");
    expect(config.entries).toMatchObject([
      {
        repoPath: ".ssh",
        rules: [
          {
            match: "exact",
            mode: "ignore",
            path: "known_hosts",
          },
        ],
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await manager.add({
      secret: true,
      target: settingsFile,
    });
    await mkdir(join(initResult.syncDirectory, "files", "mytool"), {
      recursive: true,
    });
    await writeFile(
      join(initResult.syncDirectory, "files", "mytool", "settings.json"),
      "stale plain copy\n",
    );
    await writeFile(
      join(
        initResult.syncDirectory,
        "files",
        "mytool",
        `settings.json${syncSecretArtifactSuffix}`,
      ),
      "stale encrypted copy\n",
    );

    const forgetResult = await manager.forget({
      target: "mytool/settings.json",
    });
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
        join(initResult.syncDirectory, "files", "mytool", "settings.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          initResult.syncDirectory,
          "files",
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

    const manager = createSyncManager({
      cwd: settingsDirectory,
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: settingsFile,
    });

    const forgetResult = await manager.forget({
      target: "./settings.json",
    });
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: bundleDirectory,
    });
    await manager.set({
      recursive: false,
      state: "secret",
      target: secretFile,
    });
    await manager.set({
      recursive: false,
      state: "ignore",
      target: ignoredFile,
    });

    const pushResult = await manager.push({
      dryRun: false,
    });

    expect(pushResult.plainFileCount).toBe(1);
    expect(pushResult.encryptedFileCount).toBe(1);
    expect(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "files", "bundle", "plain.txt"),
        "utf8",
      ),
    ).toBe("plain value\n");
    await expect(
      readFile(
        join(
          xdgConfigHome,
          "devsync",
          "sync",
          "files",
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
          "files",
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

    const pullResult = await manager.pull({
      dryRun: false,
    });

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

  it("rejects directory targets without --recursive and tracked file entries", async () => {
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: bundleDirectory,
    });
    await manager.add({
      secret: false,
      target: trackedFile,
    });

    await expect(
      manager.set({
        recursive: false,
        state: "ignore",
        target: cacheDirectory,
      }),
    ).rejects.toThrowError(SyncError);
    await expect(
      manager.set({
        recursive: false,
        state: "secret",
        target: trackedFile,
      }),
    ).rejects.toThrowError(SyncError);
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: bundleDirectory,
    });

    const exactAdded = await manager.set({
      recursive: false,
      state: "secret",
      target: "bundle/future.txt",
    });
    const exactUpdated = await manager.set({
      recursive: false,
      state: "ignore",
      target: "bundle/future.txt",
    });
    const exactUnchanged = await manager.set({
      recursive: false,
      state: "ignore",
      target: "bundle/future.txt",
    });
    const subtreeAdded = await manager.set({
      recursive: true,
      state: "ignore",
      target: cacheDirectory,
    });
    const subtreeUpdated = await manager.set({
      recursive: true,
      state: "secret",
      target: "bundle/cache",
    });
    const subtreeUnchanged = await manager.set({
      recursive: true,
      state: "secret",
      target: "bundle/cache",
    });
    const config = JSON.parse(
      await readFile(
        join(xdgConfigHome, "devsync", "sync", "config.json"),
        "utf8",
      ),
    ) as {
      entries: Array<{
        rules?: Array<{
          match: string;
          mode: string;
          path: string;
        }>;
      }>;
    };

    expect(exactAdded.action).toBe("added");
    expect(exactUpdated.action).toBe("updated");
    expect(exactUnchanged.action).toBe("unchanged");
    expect(subtreeAdded.action).toBe("added");
    expect(subtreeUpdated.action).toBe("updated");
    expect(subtreeUnchanged.action).toBe("unchanged");
    expect(config.entries[0]?.rules).toEqual([
      {
        match: "subtree",
        mode: "secret",
        path: "cache",
      },
      {
        match: "exact",
        mode: "ignore",
        path: "future.txt",
      },
    ]);

    await expect(
      manager.set({
        recursive: false,
        state: "secret",
        target: missingLocalPath,
      }),
    ).rejects.toThrowError(/does not exist/u);
    await expect(
      manager.set({
        recursive: false,
        state: "secret",
        target: bundleDirectory,
      }),
    ).rejects.toThrowError(/require --recursive/u);
    await expect(
      manager.set({
        recursive: true,
        state: "secret",
        target: join(cacheDirectory, "state.txt"),
      }),
    ).rejects.toThrowError(/can only be used with directories/u);
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: bundleDirectory,
    });

    const normalPush = await manager.push({
      dryRun: false,
    });

    expect(normalPush.plainFileCount).toBe(1);
    expect(
      await readFile(
        join(syncDirectory, "files", "bundle", "token.txt"),
        "utf8",
      ),
    ).toBe("token-v1\n");
    await expect(
      readFile(
        join(
          syncDirectory,
          "files",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    await manager.set({
      recursive: false,
      state: "secret",
      target: tokenFile,
    });

    const secretPush = await manager.push({
      dryRun: false,
    });

    expect(secretPush.encryptedFileCount).toBe(1);
    await expect(
      readFile(join(syncDirectory, "files", "bundle", "token.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      await readFile(
        join(
          syncDirectory,
          "files",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
        "utf8",
      ),
    ).toContain("BEGIN AGE ENCRYPTED FILE");

    await manager.set({
      recursive: false,
      state: "ignore",
      target: tokenFile,
    });

    const ignorePush = await manager.push({
      dryRun: false,
    });

    expect(ignorePush.deletedArtifactCount).toBeGreaterThanOrEqual(1);
    await expect(
      readFile(join(syncDirectory, "files", "bundle", "token.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          syncDirectory,
          "files",
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

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: bundleDirectory,
    });
    await manager.set({
      recursive: false,
      state: "secret",
      target: tokenFile,
    });
    await manager.push({
      dryRun: false,
    });
    await writeFile(
      join(
        syncDirectory,
        "files",
        "bundle",
        `token.txt${syncSecretArtifactSuffix}`,
      ),
      "not a valid age payload",
      "utf8",
    );

    await expect(
      manager.pull({
        dryRun: false,
      }),
    ).rejects.toThrowError();
  });
});
