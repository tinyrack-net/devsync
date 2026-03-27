import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createInitialSyncConfig, formatSyncConfig } from "#app/config/sync.js";
import type { ProgressReporter } from "#app/lib/progress.js";
import { DevsyncError } from "#app/services/error.js";
import { initializeSync } from "#app/services/init.js";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  runGit,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-init-");

  temporaryDirectories.push(directory);

  return directory;
};

const createEnvironment = (
  homeDirectory: string,
  xdgConfigHome: string,
): NodeJS.ProcessEnv => {
  return {
    HOME: homeDirectory,
    XDG_CONFIG_HOME: xdgConfigHome,
  };
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

    const result = await initializeSync(
      {
        ageIdentity: `  ${ageKeys.identity}  `,
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient, extraRecipient.recipient],
        repository: sourceRepository,
      },
      createEnvironment(homeDirectory, xdgConfigHome),
    );

    expect(result.generatedIdentity).toBe(false);
    expect(
      await readFile(join(xdgConfigHome, "devsync", "age", "keys.txt"), "utf8"),
    ).toBe(`${ageKeys.identity}\n`);
    expect(
      JSON.parse(
        await readFile(join(result.syncDirectory, "manifest.json"), "utf8"),
      ),
    ).toMatchObject({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
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

    await expect(
      initializeSync(
        {
          ageIdentity: "not-a-key",
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [],
        },
        createEnvironment(homeDirectory, xdgConfigHome),
      ),
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

    const result = await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
        repository: sourceRepository,
      },
      createEnvironment(homeDirectory, xdgConfigHome),
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
    ).toContain("$XDG_CONFIG_HOME/devsync/age/keys.txt");
  });

  it("rejects non-empty sync directories that are not git repositories", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const syncDirectory = join(xdgConfigHome, "devsync", "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);
    await mkdir(syncDirectory, { recursive: true });
    await writeFile(join(syncDirectory, "placeholder.txt"), "keep\n", "utf8");

    const environment = createEnvironment(homeDirectory, xdgConfigHome);

    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [ageKeys.recipient],
        },
        environment,
      ),
    ).rejects.toThrowError(DevsyncError);
    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [ageKeys.recipient],
        },
        environment,
      ),
    ).rejects.toThrowError(/Sync directory already exists and is not empty/u);
    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: [ageKeys.recipient],
        },
        environment,
      ),
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

    const environment = createEnvironment(homeDirectory, xdgConfigHome);

    await initializeSync(
      {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [ageKeys.recipient],
      },
      environment,
    );

    await expect(
      initializeSync(
        {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: ["age1differentrecipient"],
        },
        environment,
      ),
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
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
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

    const result = await initializeSync(
      {
        ageIdentity: ageKeys.identity,
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [],
        repository: sourceRepository,
      },
      createEnvironment(homeDirectory, xdgConfigHome),
    );

    expect(result.alreadyInitialized).toBe(false);
    expect(result.generatedIdentity).toBe(false);
    expect(
      await readFile(join(xdgConfigHome, "devsync", "age", "keys.txt"), "utf8"),
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
      identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
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

    const result = await initializeSync(
      {
        generateAgeIdentity: true,
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [],
        repository: sourceRepository,
      },
      createEnvironment(homeDirectory, xdgConfigHome),
    );

    expect(result.alreadyInitialized).toBe(false);
    expect(result.generatedIdentity).toBe(true);
    const identityContent = await readFile(
      join(xdgConfigHome, "devsync", "age", "keys.txt"),
      "utf8",
    );
    expect(identityContent.trim()).toMatch(/^AGE-SECRET-KEY-/u);
  });
});
