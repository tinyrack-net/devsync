import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  HOME: "",
  XDG_CONFIG_HOME: "",
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

import { createInitialSyncConfig, formatSyncConfig } from "#app/config/sync.ts";
import { DevsyncError } from "#app/lib/error.ts";
import type { ProgressReporter } from "#app/lib/progress.ts";
import { initializeSyncDirectory } from "#app/services/init.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-init-");

  temporaryDirectories.push(directory);

  return directory;
};

const setEnvironment = (homeDirectory: string, xdgConfigHome: string) => {
  mockEnv.HOME = homeDirectory;
  mockEnv.XDG_CONFIG_HOME = xdgConfigHome;
};

const createProgressCapture = (verbose = false) => {
  const messages: string[] = [];
  const reporter: ProgressReporter = {
    detail: (message: string) => {
      if (verbose) {
        messages.push(`detail:${message}`);
      }
    },
    phase: (message: string) => {
      messages.push(message);
    },
    verbose,
  };

  return {
    messages,
    reporter,
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

describe("init service", () => {
  it("writes a supplied age private key during initialization", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();
    const extraRecipient = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], workspace);

    setEnvironment(homeDirectory, xdgConfigHome);
    const result = await initializeSyncDirectory({
      ageIdentity: `  ${ageKeys.identity}  `,
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient, extraRecipient.recipient],
      repository: sourceRepository,
    });

    expect(result.generatedIdentity).toBe(false);
    expect(
      await readFile(join(xdgConfigHome, "devsync", "keys.txt"), "utf8"),
    ).toBe(`${ageKeys.identity}\n`);
    expect(
      JSON.parse(
        await readFile(join(result.syncDirectory, "manifest.json"), "utf8"),
      ),
    ).toMatchObject({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: expect.arrayContaining([
          ageKeys.recipient,
          extraRecipient.recipient,
        ]),
      },
    });
  });

  it("rejects an invalid supplied age private key", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");

    setEnvironment(homeDirectory, xdgConfigHome);
    await expect(
      initializeSyncDirectory({
        ageIdentity: "not-a-key",
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: [],
      }),
    ).rejects.toThrowError(/Invalid age private key/u);
  });

  it("clones a configured repository source during initialization", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();
    const { messages, reporter } = createProgressCapture();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await runGit(["init", "-b", "main", sourceRepository], workspace);

    setEnvironment(homeDirectory, xdgConfigHome);
    const result = await initializeSyncDirectory(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: [ageKeys.recipient],
        repository: sourceRepository,
      },
      reporter,
    );

    expect(result.gitAction).toBe("cloned");
    expect(result.gitSource).toBe(sourceRepository);
    expect(messages[0]).toBe("Initializing sync directory...");
    expect(messages).toEqual(
      expect.arrayContaining([
        `Cloning the sync repository from ${sourceRepository}...`,
        "Preparing sync encryption settings...",
        "Writing sync manifest...",
      ]),
    );
    expect(
      await readFile(join(result.syncDirectory, "manifest.json"), "utf8"),
    ).toContain('"version": 7');
    expect(
      await readFile(join(result.syncDirectory, "manifest.json"), "utf8"),
    ).toContain("$XDG_CONFIG_HOME/devsync/keys.txt");
  });

  it("rejects non-empty sync directories that are not git repositories", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const syncDirectory = join(xdgConfigHome, "devsync", "repository");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(syncDirectory, { recursive: true });
    await writeFile(join(syncDirectory, "placeholder.txt"), "keep\n", "utf8");

    setEnvironment(homeDirectory, xdgConfigHome);
    await expect(
      initializeSyncDirectory({
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: [ageKeys.recipient],
      }),
    ).rejects.toThrowError(DevsyncError);
    await expect(
      initializeSyncDirectory({
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: [ageKeys.recipient],
      }),
    ).rejects.toThrowError(/Sync directory already exists and is not empty/u);
    await expect(
      initializeSyncDirectory({
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: [ageKeys.recipient],
      }),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([`Sync directory: ${syncDirectory}`]),
    });
  });

  it("rejects recipient mismatches against an existing config", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    setEnvironment(homeDirectory, xdgConfigHome);

    await initializeSyncDirectory({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await expect(
      initializeSyncDirectory({
        identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
        recipients: ["age1differentrecipient"],
      }),
    ).rejects.toThrowError(/different age recipients/u);
  });

  it("writes a supplied age private key when cloning a repo that already has manifest.json", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], workspace);

    const manifest = createInitialSyncConfig({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await writeFile(
      join(sourceRepository, "manifest.json"),
      formatSyncConfig(manifest),
      "utf8",
    );
    await runGit(["add", "manifest.json"], sourceRepository);
    await runGit(
      ["commit", "-m", "initial config", "--author", "test <test@test.com>"],
      sourceRepository,
    );

    setEnvironment(homeDirectory, xdgConfigHome);
    const result = await initializeSyncDirectory({
      ageIdentity: ageKeys.identity,
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [],
      repository: sourceRepository,
    });

    expect(result.alreadyInitialized).toBe(false);
    expect(result.generatedIdentity).toBe(false);
    expect(
      await readFile(join(xdgConfigHome, "devsync", "keys.txt"), "utf8"),
    ).toBe(`${ageKeys.identity}\n`);
    expect(
      JSON.parse(
        await readFile(join(xdgConfigHome, "devsync", "settings.json"), "utf8"),
      ),
    ).toMatchObject({
      activeProfile: "default",
      version: 3,
    });
  });

  it("generates a new age identity when cloning a repo with manifest.json and no key is provided", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const sourceRepository = join(workspace, "remote-sync");
    const ageKeys = await createAgeKeyPair();

    await runGit(["init", "-b", "main", sourceRepository], workspace);

    const manifest = createInitialSyncConfig({
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [ageKeys.recipient],
    });

    await writeFile(
      join(sourceRepository, "manifest.json"),
      formatSyncConfig(manifest),
      "utf8",
    );
    await runGit(["add", "manifest.json"], sourceRepository);
    await runGit(
      ["commit", "-m", "initial config", "--author", "test <test@test.com>"],
      sourceRepository,
    );

    setEnvironment(homeDirectory, xdgConfigHome);
    const result = await initializeSyncDirectory({
      generateAgeIdentity: true,
      identityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
      recipients: [],
      repository: sourceRepository,
    });

    expect(result.alreadyInitialized).toBe(false);
    expect(result.generatedIdentity).toBe(true);
    const identityContent = await readFile(
      join(xdgConfigHome, "devsync", "keys.txt"),
      "utf8",
    );
    expect(identityContent.trim()).toMatch(/^AGE-SECRET-KEY-/u);
  });
});
