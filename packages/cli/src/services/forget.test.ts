import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import { resolveArtifactRelativePath } from "./repo-artifacts.ts";

const mocked = vi.hoisted(() => ({
  createSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  ensureSyncRepository: vi.fn(),
  readSyncConfig: vi.fn(),
  resolveSyncPaths: vi.fn(),
  resolveTrackedEntry: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
}));

vi.mock("#app/config/sync.ts", async () => {
  const actual = await vi.importActual<typeof import("#app/config/sync.ts")>(
    "#app/config/sync.ts",
  );

  return {
    ...actual,
    readSyncConfig: mocked.readSyncConfig,
  };
});

vi.mock("./config-file.ts", () => ({
  createSyncConfigDocument: mocked.createSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("./paths.ts", () => ({
  resolveTrackedEntry: mocked.resolveTrackedEntry,
}));

vi.mock("./runtime.ts", () => ({
  ensureSyncRepository: mocked.ensureSyncRepository,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import { forgetSyncTarget } from "./forget.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-forget-");

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

describe("sync forget service", () => {
  it("rejects blank targets without touching the repository", async () => {
    await expect(
      forgetSyncTarget({ target: "   " }, "/tmp/cwd"),
    ).rejects.toThrowError("Target path is required.");
    expect(mocked.ensureSyncRepository).not.toHaveBeenCalled();
  });

  it("rejects targets that are not currently tracked", async () => {
    const workspace = await createWorkspace();

    mocked.resolveSyncPaths.mockReturnValueOnce({
      configPath: join(workspace, "manifest.json"),
      syncDirectory: workspace,
    });
    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(undefined);

    await expect(
      forgetSyncTarget({ target: "~/.gitconfig" }, "/tmp/cwd"),
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
      configPath: join(workspace, "manifest.json"),
      syncDirectory: workspace,
    });
    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry, siblingEntry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await forgetSyncTarget(
      { target: "~/.config/tool/token.txt" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      configPath: join(workspace, "manifest.json"),
      localPath: entry.localPath,
      plainArtifactCount: 2,
      repoPath: entry.repoPath,
      secretArtifactCount: 2,
      syncDirectory: workspace,
    });
    expect(mocked.createSyncConfigDocument).toHaveBeenCalledWith({
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
      configPath: join(workspace, "manifest.json"),
      syncDirectory: workspace,
    });
    mocked.ensureSyncRepository.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await forgetSyncTarget(
      { target: "~/.config/app" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      configPath: join(workspace, "manifest.json"),
      localPath: entry.localPath,
      plainArtifactCount: 4,
      repoPath: entry.repoPath,
      secretArtifactCount: 0,
      syncDirectory: workspace,
    });
    await expect(access(plainRoot)).rejects.toThrowError();
    await expect(access(siblingPath)).resolves.toBeUndefined();
  });
});
