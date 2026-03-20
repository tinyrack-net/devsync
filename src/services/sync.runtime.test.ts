import {
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseSyncConfig,
  type ResolvedSyncConfig,
  resolveSyncArtifactsDirectoryPath,
  type SyncConfig,
  syncSecretArtifactSuffix,
} from "#app/config/sync.ts";
import { encryptSecretFile } from "#app/services/crypto.ts";
import {
  applyEntryMaterialization,
  buildEntryMaterialization,
  buildPullCounts,
  countDeletedLocalNodes,
} from "#app/services/local-materialization.ts";
import { buildLocalSnapshot } from "#app/services/local-snapshot.ts";
import {
  buildRepoArtifacts,
  collectExistingArtifactKeys,
  writeArtifactsToDirectory,
} from "#app/services/repo-artifacts.ts";
import { buildRepositorySnapshot } from "#app/services/repo-snapshot.ts";
import {
  createAgeKeyPair,
  createTemporaryDirectory,
  writeIdentityFile,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-sync-runtime-");

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

const createResolvedConfig = (
  input: Readonly<{
    entries: SyncConfig["entries"];
    homeDirectory: string;
    recipients: readonly string[];
    xdgConfigHome: string;
  }>,
): ResolvedSyncConfig => {
  return parseSyncConfig(
    {
      version: 1,
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        recipients: [...input.recipients],
      },
      entries: input.entries,
    },
    createSyncEnvironment(input.homeDirectory, input.xdgConfigHome),
  );
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("sync runtime helpers", () => {
  it("keeps explicit children under an ignored directory root in the local snapshot", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");

    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(join(bundleDirectory, "keep.txt"), "keep\n");
    await writeFile(join(bundleDirectory, "ignored.txt"), "ignored\n");

    const config = createResolvedConfig({
      entries: [
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "ignore",
          name: "bundle",
          overrides: {
            "keep.txt": "normal",
          },
          repoPath: "bundle",
        },
      ],
      homeDirectory,
      recipients: ["age1example"],
      xdgConfigHome,
    });

    const snapshot = await buildLocalSnapshot(config);

    expect(
      [...snapshot.keys()].sort((left, right) => {
        return left.localeCompare(right);
      }),
    ).toEqual(["bundle", "bundle/keep.txt"]);
  });

  it("rejects secret symlinks and file-entry kind mismatches in the local snapshot", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");

    await mkdir(bundleDirectory, { recursive: true });

    if (process.platform !== "win32") {
      await symlink("target.txt", join(bundleDirectory, "token-link"));

      const symlinkConfig = createResolvedConfig({
        entries: [
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            overrides: {
              "token-link": "secret",
            },
            repoPath: "bundle",
          },
        ],
        homeDirectory,
        recipients: ["age1example"],
        xdgConfigHome,
      });

      await expect(buildLocalSnapshot(symlinkConfig)).rejects.toThrowError(
        /Secret sync paths must be regular files/u,
      );
    }

    const mismatchConfig = createResolvedConfig({
      entries: [
        {
          kind: "file",
          localPath: "~/bundle",
          mode: "normal",
          name: "bundle",
          repoPath: "bundle",
        },
      ],
      homeDirectory,
      recipients: ["age1example"],
      xdgConfigHome,
    });

    await expect(buildLocalSnapshot(mismatchConfig)).rejects.toThrowError(
      /expects a file/u,
    );
  });

  it("rejects local descendants that use the reserved secret suffix", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");

    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(
      join(bundleDirectory, `token.txt${syncSecretArtifactSuffix}`),
      "reserved\n",
    );

    const config = createResolvedConfig({
      entries: [
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "normal",
          name: "bundle",
          repoPath: "bundle",
        },
      ],
      homeDirectory,
      recipients: ["age1example"],
      xdgConfigHome,
    });

    await expect(buildLocalSnapshot(config)).rejects.toThrowError(
      /reserved suffix/u,
    );
  });

  it("tracks executable secret files on non-Windows platforms", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");
    const secretFile = join(bundleDirectory, "secret.sh");

    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(secretFile, "#!/bin/sh\necho secret\n");
    await chmod(secretFile, 0o755);

    const config = createResolvedConfig({
      entries: [
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "normal",
          name: "bundle",
          overrides: {
            "secret.sh": "secret",
          },
          repoPath: "bundle",
        },
      ],
      homeDirectory,
      recipients: ["age1example"],
      xdgConfigHome,
    });

    const snapshot = await buildLocalSnapshot(config);
    const node = snapshot.get("bundle/secret.sh");

    expect(node).toMatchObject({
      executable: true,
      secret: true,
      type: "file",
    });
  });

  it("builds repo artifacts and collects existing artifact keys in the merged files tree", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const syncDirectory = join(workspace, "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const config = createResolvedConfig({
      entries: [
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "normal",
          name: "bundle",
          overrides: {
            "secret.txt": "secret",
          },
          repoPath: "bundle",
        },
      ],
      homeDirectory,
      recipients: [ageKeys.recipient],
      xdgConfigHome,
    });

    const snapshot = new Map([
      ["bundle", { type: "directory" as const }],
      [
        "bundle/plain.txt",
        {
          contents: new TextEncoder().encode("plain\n"),
          executable: false,
          secret: false,
          type: "file" as const,
        },
      ],
      [
        "bundle/secret.txt",
        {
          contents: new TextEncoder().encode("secret\n"),
          executable: false,
          secret: true,
          type: "file" as const,
        },
      ],
      [
        "bundle/link",
        {
          linkTarget: "plain.txt",
          type: "symlink" as const,
        },
      ],
    ]);

    const artifacts = await buildRepoArtifacts(snapshot, config);

    await writeArtifactsToDirectory(
      resolveSyncArtifactsDirectoryPath(syncDirectory),
      artifacts,
    );

    expect(await collectExistingArtifactKeys(syncDirectory, config)).toEqual(
      new Set([
        "bundle/",
        "bundle/link",
        "bundle/plain.txt",
        `bundle/secret.txt${syncSecretArtifactSuffix}`,
      ]),
    );
  });

  it("rejects invalid repository secret state and preserves explicit children under ignored roots", async () => {
    const workspace = await createWorkspace();
    const xdgConfigHome = join(workspace, "xdg");
    const syncDirectory = join(workspace, "sync");
    const ageKeys = await createAgeKeyPair();

    await writeIdentityFile(xdgConfigHome, ageKeys.identity);

    const writeSecretFile = async (
      path: string,
      contents = new TextEncoder().encode("secret\n"),
    ) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        await encryptSecretFile(contents, [ageKeys.recipient]),
        "utf8",
      );
    };

    const createConfig = (entries: SyncConfig["entries"]) => {
      return createResolvedConfig({
        entries,
        homeDirectory: join(workspace, "home"),
        recipients: [ageKeys.recipient],
        xdgConfigHome,
      });
    };

    await mkdir(join(syncDirectory, "files", "bundle"), { recursive: true });
    await writeFile(
      join(syncDirectory, "files", "bundle", "secret.txt"),
      "plain\n",
    );

    await expect(
      buildRepositorySnapshot(
        syncDirectory,
        createConfig([
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            overrides: {
              "secret.txt": "secret",
            },
            repoPath: "bundle",
          },
        ]),
      ),
    ).rejects.toThrowError(/stored as a plain artifact/u);

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(join(syncDirectory, "files", "bundle"), { recursive: true });
    await writeFile(
      join(
        syncDirectory,
        "files",
        "bundle",
        `plain.txt${syncSecretArtifactSuffix}`,
      ),
      "ciphertext ignored before decrypt",
      "utf8",
    );

    await expect(
      buildRepositorySnapshot(
        syncDirectory,
        createConfig([
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            repoPath: "bundle",
          },
        ]),
      ),
    ).rejects.toThrowError(/stored as a secret artifact/u);

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(
      join(
        syncDirectory,
        "files",
        "bundle",
        `broken${syncSecretArtifactSuffix}`,
      ),
      { recursive: true },
    );
    await writeFile(
      join(
        syncDirectory,
        "files",
        "bundle",
        `broken${syncSecretArtifactSuffix}`,
        "value.txt",
      ),
      "oops\n",
    );

    await expect(
      buildRepositorySnapshot(
        syncDirectory,
        createConfig([
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            repoPath: "bundle",
          },
        ]),
      ),
    ).rejects.toThrowError(/reserved suffix/u);

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(join(syncDirectory, "files", "other"), { recursive: true });
    await writeFile(
      join(
        syncDirectory,
        "files",
        "other",
        `token.txt${syncSecretArtifactSuffix}`,
      ),
      "ignored\n",
      "utf8",
    );

    await expect(
      buildRepositorySnapshot(
        syncDirectory,
        createConfig([
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            repoPath: "bundle",
          },
        ]),
      ),
    ).rejects.toThrowError(/not managed by the current sync configuration/u);

    if (process.platform !== "win32") {
      await rm(syncDirectory, { force: true, recursive: true });
      await mkdir(join(syncDirectory, "files", "bundle"), { recursive: true });
      await symlink(
        join(workspace, "target.secret"),
        join(
          syncDirectory,
          "files",
          "bundle",
          `token.txt${syncSecretArtifactSuffix}`,
        ),
      );

      await expect(
        buildRepositorySnapshot(
          syncDirectory,
          createConfig([
            {
              kind: "directory",
              localPath: "~/bundle",
              mode: "secret",
              name: "bundle",
              repoPath: "bundle",
            },
          ]),
        ),
      ).rejects.toThrowError(/must be regular files, not symlinks/u);
    }

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(join(syncDirectory, "files"), { recursive: true });
    await writeFile(
      join(syncDirectory, "files", "bundle"),
      "not a directory\n",
    );

    await expect(
      buildRepositorySnapshot(
        syncDirectory,
        createConfig([
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            repoPath: "bundle",
          },
        ]),
      ),
    ).rejects.toThrowError(/is not stored as a directory/u);

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(join(syncDirectory, "files", "bundle"), { recursive: true });
    await writeFile(
      join(syncDirectory, "files", "bundle", "keep.txt"),
      "keep\n",
    );

    const snapshot = await buildRepositorySnapshot(
      syncDirectory,
      createConfig([
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "ignore",
          name: "bundle",
          overrides: {
            "keep.txt": "normal",
          },
          repoPath: "bundle",
        },
      ]),
    );

    expect(
      [...snapshot.keys()].sort((left, right) => {
        return left.localeCompare(right);
      }),
    ).toEqual(["bundle", "bundle/keep.txt"]);

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(join(syncDirectory, "files", "bundle"), { recursive: true });
    await writeFile(
      join(
        syncDirectory,
        "files",
        "bundle",
        `keep.txt${syncSecretArtifactSuffix}`,
      ),
      "not really ciphertext",
      "utf8",
    );

    await expect(
      buildRepositorySnapshot(
        syncDirectory,
        createConfig([
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            overrides: {
              "keep.txt": "secret",
            },
            repoPath: "bundle",
          },
        ]),
      ),
    ).rejects.toThrowError();

    await rm(syncDirectory, { force: true, recursive: true });
    await mkdir(join(syncDirectory, "files", "bundle"), { recursive: true });
    await writeSecretFile(
      join(
        syncDirectory,
        "files",
        "bundle",
        `keep.txt${syncSecretArtifactSuffix}`,
      ),
    );

    const decrypted = await buildRepositorySnapshot(
      syncDirectory,
      createConfig([
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "normal",
          name: "bundle",
          overrides: {
            "keep.txt": "secret",
          },
          repoPath: "bundle",
        },
      ]),
    );

    expect(
      new TextDecoder().decode(
        (decrypted.get("bundle/keep.txt") as { contents: Uint8Array }).contents,
      ),
    ).toBe("secret\n");
  });

  it("validates materialization conflicts, preserves ignored locals, and counts pull results", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");
    const bundleDirectory = join(homeDirectory, "bundle");

    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(join(bundleDirectory, "keep.txt"), "keep\n");
    await writeFile(join(bundleDirectory, "ignored.txt"), "ignored\n");

    const config = createResolvedConfig({
      entries: [
        {
          kind: "directory",
          localPath: "~/bundle",
          mode: "ignore",
          name: "bundle",
          overrides: {
            "keep.txt": "normal",
          },
          repoPath: "bundle",
        },
        {
          kind: "file",
          localPath: "~/.ignored-file",
          mode: "ignore",
          name: ".ignored-file",
          repoPath: ".ignored-file",
        },
      ],
      homeDirectory,
      recipients: ["age1example"],
      xdgConfigHome,
    });
    const bundleEntry = config.entries.find((entry) => {
      return entry.repoPath === "bundle";
    });
    const ignoredFileEntry = config.entries.find((entry) => {
      return entry.repoPath === ".ignored-file";
    });

    if (bundleEntry === undefined || ignoredFileEntry === undefined) {
      throw new Error("Expected test sync entries to be present.");
    }

    await writeFile(join(homeDirectory, ".ignored-file"), "leave me alone\n");

    expect(() => {
      buildEntryMaterialization(
        ignoredFileEntry,
        new Map([[".ignored-file", { type: "directory" as const }]]),
      );
    }).toThrowError(/resolves to a directory/u);

    expect(() => {
      buildEntryMaterialization(
        bundleEntry,
        new Map([
          [
            "bundle",
            {
              contents: new TextEncoder().encode("wrong"),
              executable: false,
              secret: false,
              type: "file" as const,
            },
          ],
        ]),
      );
    }).toThrowError(/resolves to a file/u);

    expect(
      await countDeletedLocalNodes(
        bundleEntry,
        new Set(["bundle/", "bundle/keep.txt"]),
        config,
      ),
    ).toBe(0);

    await applyEntryMaterialization(
      ignoredFileEntry,
      {
        desiredKeys: new Set<string>(),
        type: "absent",
      },
      config,
    );

    expect(await readFile(join(homeDirectory, ".ignored-file"), "utf8")).toBe(
      "leave me alone\n",
    );

    expect(
      buildPullCounts([
        {
          desiredKeys: new Set(["plain.txt"]),
          node: {
            contents: new TextEncoder().encode("plain"),
            executable: false,
            secret: false,
            type: "file",
          },
          type: "file",
        },
        {
          desiredKeys: new Set(["secret.txt"]),
          node: {
            contents: new TextEncoder().encode("secret"),
            executable: false,
            secret: true,
            type: "file",
          },
          type: "file",
        },
        {
          desiredKeys: new Set(["bundle/", "bundle/link"]),
          nodes: new Map([
            [
              "link",
              {
                linkTarget: "plain.txt",
                type: "symlink",
              },
            ],
          ]),
          type: "directory",
        },
      ]),
    ).toEqual({
      decryptedFileCount: 1,
      directoryCount: 1,
      plainFileCount: 1,
      symlinkCount: 1,
    });
  });
});
