import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import { createMockReadEnv } from "#test/helpers/mock-factories.ts";
import { resolveArtifactRelativePath } from "./repo-artifacts.ts";

const mocked = vi.hoisted(() => ({
  buildSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  requireGitRepository: vi.fn(),
  readSyncConfig: vi.fn(),
  resolveSyncConfigResolutionContext: vi.fn(() => ({
    homeDirectory: "/tmp/home",
    platformKey: "linux",
    readEnv: createMockReadEnv(),
    xdgConfigHome: "/tmp/home/.config",
  })),
  resolveSyncPaths: vi.fn(),
  resolveTrackedEntry: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
}));

vi.mock("#app/config/sync-schema.ts", async () => {
  const actual = await vi.importActual<
    typeof import("#app/config/sync-schema.ts")
  >("#app/config/sync-schema.ts");

  return {
    ...actual,
    readSyncConfig: mocked.readSyncConfig,
  };
});

vi.mock("./config-file.ts", () => ({
  buildSyncConfigDocument: mocked.buildSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("./sync-paths.ts", () => ({
  resolveTrackedEntry: mocked.resolveTrackedEntry,
}));

vi.mock("#app/lib/git.ts", () => ({
  requireGitRepository: mocked.requireGitRepository,
}));

vi.mock("./sync-context.ts", () => {
  const loadWritableSyncConfig = vi.fn(async () => {
    const paths = mocked.resolveSyncPaths();
    await mocked.requireGitRepository(paths.syncDirectory);
    const config = await mocked.readSyncConfig(
      paths.syncDirectory,
      mocked.resolveSyncConfigResolutionContext(),
    );
    return {
      config,
      configPath: paths.configPath,
      context: mocked.resolveSyncConfigResolutionContext(),
      syncDirectory: paths.syncDirectory,
    };
  });

  return {
    resolveSyncConfigResolutionContext:
      mocked.resolveSyncConfigResolutionContext,
    resolveSyncPaths: mocked.resolveSyncPaths,
    loadWritableSyncConfig,
  };
});

import { untrackTarget } from "./untrack.ts";

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
  vi.clearAllMocks();

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
    expect(mocked.requireGitRepository).not.toHaveBeenCalled();
  });

  it("rejects targets that are not currently tracked", async () => {
    const workspace = await createWorkspace();

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(undefined);

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

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry, siblingEntry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await untrackTarget(
      { target: "~/.config/tool/token.txt" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      localPath: entry.localPath,
      plainArtifactCount: 2,
      repoPath: entry.repoPath,
      secretArtifactCount: 2,
    });
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
      entries: [siblingEntry],
      version: 7,
    });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(workspace, {
      document: {
        entries: [siblingEntry],
        version: 7,
      },
    });
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

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await untrackTarget({ target: "~/.config/app" }, "/tmp/cwd");

    expect(result).toEqual({
      localPath: entry.localPath,
      plainArtifactCount: 4,
      repoPath: entry.repoPath,
      secretArtifactCount: 0,
    });
    await expect(access(plainRoot)).rejects.toThrowError();
    await expect(access(siblingPath)).resolves.toBeUndefined();
  });

  it("removes secret artifacts for file entries with secret mode", async () => {
    const workspace = await createWorkspace();
    const entry = {
      kind: "file",
      localPath: "/tmp/home/.env",
      profiles: [],
      repoPath: ".env",
    };
    const defaultSecretPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "secret",
        profile: "default",
        repoPath: entry.repoPath,
      }).split("/"),
    );

    await writeArtifactFile(defaultSecretPath, "secret-key=value\n");

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await untrackTarget({ target: "~/.env" }, "/tmp/cwd");

    expect(result.secretArtifactCount).toBeGreaterThan(0);
    await expect(access(defaultSecretPath)).rejects.toThrowError();
  });

  it("handles untracking the last entry in the config", async () => {
    const workspace = await createWorkspace();
    const entry = {
      kind: "file",
      localPath: "/tmp/home/.gitconfig",
      profiles: [],
      repoPath: ".gitconfig",
    };

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    await untrackTarget({ target: "~/.gitconfig" }, "/tmp/cwd");

    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
      entries: [],
      version: 7,
    });
  });

  it("counts artifacts correctly for entries with multiple profiles", async () => {
    const workspace = await createWorkspace();
    const entry = {
      kind: "file",
      localPath: "/tmp/home/.gitconfig",
      profiles: ["work", "personal"],
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
    const personalPlainPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "plain",
        profile: "personal",
        repoPath: entry.repoPath,
      }).split("/"),
    );

    await writeArtifactFile(defaultPlainPath);
    await writeArtifactFile(workPlainPath);
    await writeArtifactFile(personalPlainPath);

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await untrackTarget({ target: "~/.gitconfig" }, "/tmp/cwd");

    expect(result.plainArtifactCount).toBe(3);
  });

  it("prunes deeply nested empty parent directories after artifact removal", async () => {
    const workspace = await createWorkspace();
    const entry = {
      kind: "file",
      localPath: "/tmp/home/.config/deep/nested/path/file.txt",
      profiles: ["work"],
      repoPath: ".config/deep/nested/path/file.txt",
    };
    const artifactPath = join(
      workspace,
      ...resolveArtifactRelativePath({
        category: "plain",
        profile: "work",
        repoPath: entry.repoPath,
      }).split("/"),
    );

    await writeArtifactFile(artifactPath);

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.jsonc"),
      homeDirectory: "/tmp/home",
      syncDirectory: workspace,
    });
    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    await untrackTarget(
      { target: "~/.config/deep/nested/path/file.txt" },
      "/tmp/cwd",
    );

    await expect(access(artifactPath)).rejects.toThrowError();
    await expect(access(dirname(artifactPath))).rejects.toThrowError();
    await expect(
      access(dirname(dirname(dirname(artifactPath)))),
    ).rejects.toThrowError();
  });
});
