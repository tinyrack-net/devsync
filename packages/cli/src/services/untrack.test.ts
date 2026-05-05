import { afterEach, describe, expect, it, mock } from "bun:test";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { createTemporaryDirectory } from "../test/helpers/sync-fixture.ts";
import { resolveArtifactRelativePath } from "./repo-artifacts.ts";

mock.module("#app/config/sync.ts", () => ({
  readSyncConfig: mock(),
}));

mock.module("./config-file.ts", () => ({
  buildSyncConfigDocument: mock((config: unknown) => ({
    document: config,
  })),
  writeValidatedSyncConfig: mock(),
}));

mock.module("./paths.ts", () => ({
  resolveTrackedEntry: mock(),
}));

mock.module("#app/lib/git.ts", () => ({
  ensureGitRepository: mock(),
}));

mock.module("./runtime.ts", () => ({
  resolveSyncConfigResolutionContext: mock(() => ({
    homeDirectory: "/tmp/home",
    platformKey: "linux",
    readEnv: (_name: string) => undefined as string | undefined,
    xdgConfigHome: "/tmp/home/.config",
  })),
  resolveSyncPaths: mock(),
}));

import * as mockedSync from "#app/config/sync.ts";
import * as mockedGit from "#app/lib/git.ts";
import * as mockedConfigFile from "./config-file.ts";
import * as mockedPaths from "./paths.ts";
import * as mockedRuntime from "./runtime.ts";

import { untrackTarget } from "./untrack.ts";

type MockFn = ReturnType<typeof mock>;

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-untrack-");

  temporaryDirectories.push(directory);

  return directory;
};

const writeArtifactFile = async (path: string, contents = "value\n") => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
};

afterEach(async () => {
  mock.clearAllMocks();

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("untrack service", () => {
  it("rejects blank targets without touching the repository", async () => {
    await expect(
      untrackTarget({ target: "   " }, "/tmp/cwd"),
    ).rejects.toThrowError("Target path is required.");
    expect(mockedGit.ensureGitRepository).not.toHaveBeenCalled();
  });

  it("rejects targets that are not currently tracked", async () => {
    const workspace = await createWorkspace();

    (mockedRuntime.resolveSyncPaths as MockFn).mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [],
      version: 7,
    });
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(undefined);

    await expect(
      untrackTarget({ target: "~/.gitconfig" }, "/tmp/cwd"),
    ).rejects.toThrowError("No tracked sync entry matches: ~/.gitconfig");
  });

  it("removes tracked file artifacts across namespaces and prunes empty parents", async () => {
    const workspace = await createWorkspace();
    const entry = {
      kind: "file",
      localPath: "/tmp/home/.config/tool/token.txt",
      profiles: ["work"],
      repoPath: ".config/tool/token.txt",
    };
    const siblingEntry = {
      kind: "file",
      localPath: "/tmp/home/.gitconfig",
      profiles: [],
      repoPath: ".gitconfig",
    };
    const defaultPlainPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "plain",
        profile: "default",
        repoPath: entry.repoPath,
      }).split("/"),
    );
    const workPlainPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "plain",
        profile: "work",
        repoPath: entry.repoPath,
      }).split("/"),
    );
    const defaultSecretPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "secret",
        profile: "default",
        repoPath: entry.repoPath,
      }).split("/"),
    );
    const workSecretPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "secret",
        profile: "work",
        repoPath: entry.repoPath,
      }).split("/"),
    );

    await writeArtifactFile(defaultPlainPath);
    await writeArtifactFile(workPlainPath);
    await writeArtifactFile(defaultSecretPath, "secret-default\n");
    await writeArtifactFile(workSecretPath, "secret-work\n");

    (mockedRuntime.resolveSyncPaths as MockFn).mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [entry, siblingEntry],
      version: 7,
    });
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(entry);

    const result = await untrackTarget(
      { target: "~/.config/tool/token.txt" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      configPath: join(workspace, "manifest.jsonc"),
      localPath: entry.localPath,
      plainArtifactCount: 2,
      repoPath: entry.repoPath,
      secretArtifactCount: 2,
      syncDirectory: workspace,
    });
    expect(mockedConfigFile.buildSyncConfigDocument).toHaveBeenCalledWith({
      entries: [siblingEntry],
      version: 7,
    });
    expect(mockedConfigFile.writeValidatedSyncConfig).toHaveBeenCalledWith(
      workspace,
      {
        document: {
          entries: [siblingEntry],
          version: 7,
        },
      },
      expect.objectContaining({
        homeDirectory: "/tmp/home",
        platformKey: "linux",
        xdgConfigHome: "/tmp/home/.config",
      }),
    );
    await expect(access(defaultPlainPath)).rejects.toThrowError();
    await expect(access(workPlainPath)).rejects.toThrowError();
    await expect(access(defaultSecretPath)).rejects.toThrowError();
    await expect(access(workSecretPath)).rejects.toThrowError();
  });

  it("counts and removes directory artifacts while leaving unrelated siblings intact", async () => {
    const workspace = await createWorkspace();
    const entry = {
      kind: "directory",
      localPath: "/tmp/home/.config/app",
      profiles: ["work"],
      repoPath: ".config/app",
    };
    const plainRoot = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "plain",
        profile: "default",
        repoPath: entry.repoPath,
      }).split("/"),
    );
    const siblingPath = join(workspace, "default", ".config", "keep.txt");

    await mkdir(join(plainRoot, "nested"), { recursive: true });
    await writeFile(join(plainRoot, "settings.json"), "{}\n", "utf8");
    await writeFile(join(plainRoot, "nested", "value.txt"), "hello\n", "utf8");
    await writeArtifactFile(siblingPath, "keep\n");

    (mockedRuntime.resolveSyncPaths as MockFn).mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(entry);

    const result = await untrackTarget({ target: "~/.config/app" }, "/tmp/cwd");

    expect(result).toEqual({
      configPath: join(workspace, "manifest.jsonc"),
      localPath: entry.localPath,
      plainArtifactCount: 4,
      repoPath: entry.repoPath,
      secretArtifactCount: 0,
      syncDirectory: workspace,
    });
    await expect(access(plainRoot)).rejects.toThrowError();
    await expect(access(siblingPath)).resolves.toBeFalsy();
  });
});
