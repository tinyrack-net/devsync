import {
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSyncManager, SyncError } from "#app/services/sync/index.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
  writeJsonFile,
} from "./helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devtools-sync-test-");

  temporaryDirectories.push(directory);

  return directory;
};

const updateSyncConfig = async (syncDirectory: string, value: unknown) => {
  await writeJsonFile(join(syncDirectory, "config.json"), value);
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
      join(xdgConfigHome, "devtools", "age", "keys.txt"),
    );
    expect(config.age.identityFile).toBe(
      "$XDG_CONFIG_HOME/devtools/age/keys.txt",
    );
    expect(config.age.recipients).toHaveLength(1);
    expect(
      await readFile(
        join(xdgConfigHome, "devtools", "age", "keys.txt"),
        "utf8",
      ),
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
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    expect(result.syncDirectory).toBe(join(xdgConfigHome, "devtools", "sync"));
    expect(result.gitAction).toBe("initialized");
    expect(
      await readFile(join(result.syncDirectory, "config.json"), "utf8"),
    ).toContain("$XDG_CONFIG_HOME/devtools/age/keys.txt");

    const gitResult = await runGit(
      ["-C", result.syncDirectory, "rev-parse", "--is-inside-work-tree"],
      workspace,
    );

    expect(gitResult.stdout.trim()).toBe("true");
  });

  it("adds tracked entries and entry-scoped canonical secret globs", async () => {
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
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
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
      entries: Array<{
        kind: string;
        localPath: string;
        name: string;
        repoPath: string;
        ignoreGlobs?: string[];
        secretGlobs?: string[];
      }>;
      ignoreGlobs: string[];
      secretGlobs: string[];
    };

    expect(fileAddResult.alreadyTracked).toBe(false);
    expect(fileAddResult.repoPath).toBe(".config/mytool/settings.json");
    expect(fileAddResult.localPath).toBe(settingsFile);
    expect(repeatFileAddResult.alreadyTracked).toBe(true);
    expect(repeatFileAddResult.secretGlobAdded).toBe(true);
    expect(directoryAddResult.repoPath).toBe(".config/mytool/secrets");
    expect(directoryAddResult.kind).toBe("directory");
    expect(config.entries).toEqual([
      {
        kind: "directory",
        localPath: "~/.config/mytool/secrets",
        name: ".config/mytool/secrets",
        repoPath: ".config/mytool/secrets",
        secretGlobs: ["**"],
      },
      {
        kind: "file",
        localPath: "~/.config/mytool/settings.json",
        name: ".config/mytool/settings.json",
        repoPath: ".config/mytool/settings.json",
        secretGlobs: ["*"],
      },
    ]);
    expect(config.ignoreGlobs).toEqual([]);
    expect(config.secretGlobs).toEqual([]);
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
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await manager.add({
      secret: true,
      target: settingsFile,
    });
    await mkdir(join(initResult.syncDirectory, "plain", "mytool"), {
      recursive: true,
    });
    await mkdir(join(initResult.syncDirectory, "secret", "mytool"), {
      recursive: true,
    });
    await writeFile(
      join(initResult.syncDirectory, "plain", "mytool", "settings.json"),
      "stale plain copy\n",
    );
    await writeFile(
      join(initResult.syncDirectory, "secret", "mytool", "settings.json.age"),
      "stale encrypted copy\n",
    );

    const forgetResult = await manager.forget({
      target: "mytool/settings.json",
    });
    const config = JSON.parse(
      await readFile(join(initResult.syncDirectory, "config.json"), "utf8"),
    ) as {
      entries: unknown[];
      secretGlobs: string[];
    };

    expect(forgetResult.repoPath).toBe("mytool/settings.json");
    expect(forgetResult.plainArtifactCount).toBe(1);
    expect(forgetResult.secretArtifactCount).toBe(1);
    expect(forgetResult.secretGlobRemoved).toBe(true);
    expect(config.entries).toEqual([]);
    expect(config.secretGlobs).toEqual([]);
    await expect(
      readFile(
        join(initResult.syncDirectory, "plain", "mytool", "settings.json"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(initResult.syncDirectory, "secret", "mytool", "settings.json.age"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("forgets legacy global canonical secret globs", async () => {
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
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await updateSyncConfig(initResult.syncDirectory, {
      version: 1,
      age: {
        identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      entries: [
        {
          name: "settings",
          kind: "file",
          localPath: "~/mytool/settings.json",
          repoPath: "mytool/settings.json",
        },
      ],
      ignoreGlobs: [],
      secretGlobs: ["mytool/settings.json"],
    });

    const forgetResult = await manager.forget({
      target: settingsFile,
    });
    const config = JSON.parse(
      await readFile(join(initResult.syncDirectory, "config.json"), "utf8"),
    ) as {
      secretGlobs: string[];
    };

    expect(forgetResult.secretGlobRemoved).toBe(true);
    expect(config.secretGlobs).toEqual([]);
  });

  it("rejects add targets outside HOME and basename-only forget", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const otherDirectory = join(workspace, "other");
    const settingsDirectory = join(homeDirectory, "mytool");
    const settingsFile = join(settingsDirectory, "settings.json");
    const outsideFile = join(otherDirectory, "outside.json");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(settingsDirectory, { recursive: true });
    await mkdir(otherDirectory, { recursive: true });
    await writeFile(settingsFile, "{}\n");
    await writeFile(outsideFile, "{}\n");

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });

    await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });
    await manager.add({
      secret: false,
      target: settingsFile,
    });

    await expect(
      manager.add({
        secret: false,
        target: outsideFile,
      }),
    ).rejects.toThrowError(SyncError);
    await expect(
      manager.forget({
        target: "settings.json",
      }),
    ).rejects.toThrowError(SyncError);
  });

  it("pushes encrypted snapshots and pulls them back with mirror deletion", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const localBundlePath = join(homeDirectory, "devtools-local", "bundle");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await updateSyncConfig(initResult.syncDirectory, {
      version: 1,
      age: {
        identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      entries: [
        {
          name: "bundle",
          kind: "directory",
          localPath: "~/devtools-local/bundle",
          repoPath: "bundle",
          secretGlobs: ["secret.json"],
        },
      ],
      ignoreGlobs: [],
      secretGlobs: [],
    });

    await mkdir(localBundlePath, { recursive: true });
    await writeFile(join(localBundlePath, "plain.txt"), "plain value\n");
    await writeFile(
      join(localBundlePath, "secret.json"),
      JSON.stringify({ token: "super-secret-token" }, null, 2),
    );
    await writeFile(
      join(initResult.syncDirectory, "plain", "stale.txt"),
      "stale",
    );
    await mkdir(join(initResult.syncDirectory, "secret"), { recursive: true });
    await writeFile(
      join(initResult.syncDirectory, "secret", "stale.txt.age"),
      "stale secret",
    );
    await symlink("plain.txt", join(localBundlePath, "plain-link"));

    const pushResult = await manager.push({ dryRun: false });

    expect(pushResult.plainFileCount).toBe(1);
    expect(pushResult.encryptedFileCount).toBe(1);
    expect(pushResult.symlinkCount).toBe(1);
    expect(pushResult.directoryCount).toBe(1);
    expect(
      await readFile(
        join(initResult.syncDirectory, "plain", "bundle", "plain.txt"),
        "utf8",
      ),
    ).toBe("plain value\n");
    expect(
      await readFile(
        join(initResult.syncDirectory, "secret", "bundle", "secret.json.age"),
        "utf8",
      ),
    ).not.toContain("super-secret-token");
    expect(
      await readlink(
        join(initResult.syncDirectory, "plain", "bundle", "plain-link"),
      ),
    ).toBe("plain.txt");
    await expect(
      readFile(join(initResult.syncDirectory, "plain", "stale.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(join(localBundlePath, "plain.txt"), "wrong value\n");
    await writeFile(
      join(localBundlePath, "secret.json"),
      JSON.stringify({ token: "wrong-secret" }, null, 2),
    );
    await writeFile(join(localBundlePath, "extra.txt"), "delete me\n");
    await rm(join(localBundlePath, "plain-link"), { force: true });

    const pullResult = await manager.pull({ dryRun: false });

    expect(pullResult.plainFileCount).toBe(1);
    expect(pullResult.decryptedFileCount).toBe(1);
    expect(pullResult.symlinkCount).toBe(1);
    expect(pullResult.directoryCount).toBe(1);
    expect(await readFile(join(localBundlePath, "plain.txt"), "utf8")).toBe(
      "plain value\n",
    );
    expect(
      await readFile(join(localBundlePath, "secret.json"), "utf8"),
    ).toContain("super-secret-token");
    expect(await readlink(join(localBundlePath, "plain-link"))).toBe(
      "plain.txt",
    );
    await expect(
      readFile(join(localBundlePath, "extra.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects secret symlinks on push", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const localBundlePath = join(homeDirectory, "devtools-local", "bundle");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await updateSyncConfig(initResult.syncDirectory, {
      version: 1,
      age: {
        identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      entries: [
        {
          name: "bundle",
          kind: "directory",
          localPath: "~/devtools-local/bundle",
          repoPath: "bundle",
          secretGlobs: ["secret-link"],
        },
      ],
      ignoreGlobs: [],
      secretGlobs: [],
    });

    await mkdir(localBundlePath, { recursive: true });
    await writeFile(join(localBundlePath, "target.txt"), "hello\n");
    await symlink("target.txt", join(localBundlePath, "secret-link"));

    await expect(manager.push({ dryRun: false })).rejects.toThrowError(
      SyncError,
    );
  });

  it("omits ignored paths on push and preserves them on pull", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const localBundlePath = join(homeDirectory, "devtools-local", "bundle");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const manager = createSyncManager({
      environment: createSyncEnvironment(homeDirectory, xdgConfigHome),
    });
    const initResult = await manager.init({
      identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await updateSyncConfig(initResult.syncDirectory, {
      version: 1,
      age: {
        identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      entries: [
        {
          name: "bundle",
          kind: "directory",
          localPath: "~/devtools-local/bundle",
          repoPath: "bundle",
          ignoreGlobs: [
            "ignored-dir/**",
            "ignored-local.txt",
            "ignored-secret.json",
          ],
          secretGlobs: ["ignored-secret.json", "secret.json"],
        },
      ],
      ignoreGlobs: ["bundle/global-ignore.txt"],
      secretGlobs: [],
    });

    await mkdir(join(localBundlePath, "ignored-dir"), { recursive: true });
    await writeFile(join(localBundlePath, "plain.txt"), "plain value\n");
    await writeFile(
      join(localBundlePath, "secret.json"),
      JSON.stringify({ token: "super-secret-token" }, null, 2),
    );
    await writeFile(
      join(localBundlePath, "ignored-local.txt"),
      "ignored local value\n",
    );
    await writeFile(
      join(localBundlePath, "global-ignore.txt"),
      "ignored by global rule\n",
    );
    await writeFile(
      join(localBundlePath, "ignored-secret.json"),
      JSON.stringify({ token: "ignored-secret-local" }, null, 2),
    );
    await writeFile(
      join(localBundlePath, "ignored-dir", "keep.txt"),
      "ignored subtree value\n",
    );
    await mkdir(
      join(initResult.syncDirectory, "plain", "bundle", "ignored-dir"),
      {
        recursive: true,
      },
    );
    await mkdir(join(initResult.syncDirectory, "secret", "bundle"), {
      recursive: true,
    });
    await writeFile(
      join(initResult.syncDirectory, "plain", "bundle", "ignored-local.txt"),
      "stale ignored local copy\n",
    );
    await writeFile(
      join(initResult.syncDirectory, "plain", "bundle", "global-ignore.txt"),
      "stale ignored global copy\n",
    );
    await writeFile(
      join(
        initResult.syncDirectory,
        "plain",
        "bundle",
        "ignored-dir",
        "keep.txt",
      ),
      "stale ignored subtree copy\n",
    );
    await writeFile(
      join(
        initResult.syncDirectory,
        "secret",
        "bundle",
        "ignored-secret.json.age",
      ),
      "stale ignored secret copy\n",
    );

    const pushResult = await manager.push({ dryRun: false });

    expect(pushResult.plainFileCount).toBe(1);
    expect(pushResult.encryptedFileCount).toBe(1);
    expect(pushResult.directoryCount).toBe(1);
    expect(await readFile(join(localBundlePath, "plain.txt"), "utf8")).toBe(
      "plain value\n",
    );
    expect(
      await readFile(
        join(initResult.syncDirectory, "plain", "bundle", "plain.txt"),
        "utf8",
      ),
    ).toBe("plain value\n");
    expect(
      await readFile(
        join(initResult.syncDirectory, "secret", "bundle", "secret.json.age"),
        "utf8",
      ),
    ).not.toContain("super-secret-token");
    await expect(
      readFile(
        join(initResult.syncDirectory, "plain", "bundle", "ignored-local.txt"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(initResult.syncDirectory, "plain", "bundle", "global-ignore.txt"),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          initResult.syncDirectory,
          "plain",
          "bundle",
          "ignored-dir",
          "keep.txt",
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(
        join(
          initResult.syncDirectory,
          "secret",
          "bundle",
          "ignored-secret.json.age",
        ),
        "utf8",
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(join(localBundlePath, "plain.txt"), "wrong value\n");
    await writeFile(
      join(localBundlePath, "secret.json"),
      JSON.stringify({ token: "wrong-secret" }, null, 2),
    );
    await writeFile(join(localBundlePath, "extra.txt"), "delete me\n");
    await writeFile(
      join(localBundlePath, "ignored-local.txt"),
      "ignored local changed\n",
    );
    await writeFile(
      join(localBundlePath, "global-ignore.txt"),
      "global ignore changed\n",
    );
    await writeFile(
      join(localBundlePath, "ignored-secret.json"),
      JSON.stringify({ token: "ignored-secret-changed" }, null, 2),
    );
    await writeFile(
      join(localBundlePath, "ignored-dir", "keep.txt"),
      "ignored subtree changed\n",
    );

    const pullResult = await manager.pull({ dryRun: false });

    expect(pullResult.plainFileCount).toBe(1);
    expect(pullResult.decryptedFileCount).toBe(1);
    expect(pullResult.directoryCount).toBe(1);
    expect(pullResult.deletedLocalCount).toBe(1);
    expect(await readFile(join(localBundlePath, "plain.txt"), "utf8")).toBe(
      "plain value\n",
    );
    expect(
      await readFile(join(localBundlePath, "secret.json"), "utf8"),
    ).toContain("super-secret-token");
    expect(
      await readFile(join(localBundlePath, "ignored-local.txt"), "utf8"),
    ).toBe("ignored local changed\n");
    expect(
      await readFile(join(localBundlePath, "global-ignore.txt"), "utf8"),
    ).toBe("global ignore changed\n");
    expect(
      await readFile(join(localBundlePath, "ignored-secret.json"), "utf8"),
    ).toContain("ignored-secret-changed");
    expect(
      await readFile(join(localBundlePath, "ignored-dir", "keep.txt"), "utf8"),
    ).toBe("ignored subtree changed\n");
    await expect(
      readFile(join(localBundlePath, "extra.txt"), "utf8"),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
