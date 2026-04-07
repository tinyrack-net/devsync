import type { ConsolaInstance } from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  applyEntryMaterialization: vi.fn(),
  buildEntryMaterialization: vi.fn(),
  buildPullCounts: vi.fn(() => ({
    decryptedFileCount: 0,
    directoryCount: 0,
    plainFileCount: 0,
    symlinkCount: 0,
  })),
  buildRepositorySnapshot: vi.fn(),
  collectChangedLocalPaths: vi.fn(),
  countDeletedLocalNodes: vi.fn(),
  ensureGitRepository: vi.fn(),
  loadSyncConfig: vi.fn(),
  resolveSyncConfigFilePath: vi.fn(
    (syncDirectory: string) => `${syncDirectory}/manifest.jsonc`,
  ),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/devsync",
  })),
}));

vi.mock("#app/config/sync.ts", () => ({
  resolveSyncConfigFilePath: mocked.resolveSyncConfigFilePath,
}));

vi.mock("./local-materialization.ts", () => ({
  applyEntryMaterialization: mocked.applyEntryMaterialization,
  buildEntryMaterialization: mocked.buildEntryMaterialization,
  buildPullCounts: mocked.buildPullCounts,
  collectChangedLocalPaths: mocked.collectChangedLocalPaths,
  countDeletedLocalNodes: mocked.countDeletedLocalNodes,
}));

vi.mock("./repo-snapshot.ts", () => ({
  buildRepositorySnapshot: mocked.buildRepositorySnapshot,
}));

vi.mock("#app/lib/git.ts", () => ({
  ensureGitRepository: mocked.ensureGitRepository,
}));

vi.mock("./runtime.ts", () => ({
  loadSyncConfig: mocked.loadSyncConfig,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import {
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
  pullChanges,
} from "./pull.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("pull helpers", () => {
  it("builds a stable preview from desired and deleted local paths", () => {
    expect(
      buildPullPlanPreview({
        counts: {
          decryptedFileCount: 1,
          directoryCount: 1,
          plainFileCount: 2,
          symlinkCount: 0,
        },
        deletedLocalCount: 2,
        deletedLocalPaths: ["/tmp/obsolete-a", "/tmp/obsolete-b"],
        desiredKeys: new Set([
          "zeta/file.txt",
          "alpha/file.txt",
          "beta/file.txt",
          "gamma/file.txt",
          "delta/file.txt",
        ]),
        existingKeys: new Set(["alpha/file.txt", "obsolete-a", "obsolete-b"]),
        materializations: [],
        updatedLocalPaths: [
          "/tmp/alpha/file.txt",
          "/tmp/beta/file.txt",
          "/tmp/delta/file.txt",
          "/tmp/gamma/file.txt",
          "/tmp/zeta/file.txt",
        ],
      }),
    ).toEqual([
      "/tmp/alpha/file.txt",
      "/tmp/beta/file.txt",
      "/tmp/delta/file.txt",
      "/tmp/gamma/file.txt",
      "/tmp/obsolete-a",
      "/tmp/obsolete-b",
    ]);
  });

  it("builds pull results from a completed plan", () => {
    expect(
      buildPullResultFromPlan(
        {
          counts: {
            decryptedFileCount: 3,
            directoryCount: 1,
            plainFileCount: 2,
            symlinkCount: 0,
          },
          deletedLocalCount: 4,
          deletedLocalPaths: [],
          desiredKeys: new Set(),
          existingKeys: new Set(),
          materializations: [],
          updatedLocalPaths: [],
        },
        "/tmp/devsync",
        true,
      ),
    ).toEqual({
      configPath: "/tmp/devsync/manifest.jsonc",
      decryptedFileCount: 3,
      deletedLocalCount: 4,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 2,
      symlinkCount: 0,
      syncDirectory: "/tmp/devsync",
    });
  });
});

describe("pull planning", () => {
  it("skips ignore-mode entries while planning materializations", async () => {
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.buildEntryMaterialization.mockReturnValue({
      desiredKeys: new Set([".config/app"]),
      type: "absent",
    });
    mocked.countDeletedLocalNodes.mockResolvedValue(0);
    mocked.collectChangedLocalPaths.mockResolvedValue([]);

    const config = {
      age: {
        identityFile: "/tmp/devsync/keys.txt",
        recipients: ["age1recipient"],
      },
      entries: [
        {
          kind: "directory",
          localPath: "/tmp/home/.config/app",
          mode: "normal",
          repoPath: ".config/app",
        },
        {
          kind: "directory",
          localPath: "/tmp/home/.config/app/node_modules",
          mode: "ignore",
          repoPath: ".config/app/node_modules",
        },
      ],
      version: 7,
    };

    const plan = await buildPullPlan(config as never, "/tmp/devsync");

    expect(mocked.buildEntryMaterialization).toHaveBeenCalledTimes(1);
    expect(mocked.buildEntryMaterialization).toHaveBeenCalledWith(
      config.entries[0],
      expect.any(Map),
      undefined,
    );
    expect(mocked.countDeletedLocalNodes).toHaveBeenCalledTimes(1);
    expect(mocked.countDeletedLocalNodes).toHaveBeenCalledWith(
      config.entries[0],
      new Set([".config/app"]),
      config,
      expect.any(Set),
      undefined,
      expect.any(Map),
    );
    expect(plan.materializations).toEqual([
      {
        desiredKeys: new Set([".config/app"]),
        type: "absent",
      },
      undefined,
    ]);
    expect(plan.desiredKeys).toEqual(new Set([".config/app"]));
    expect(plan.updatedLocalPaths).toEqual([]);
    expect(plan.deletedLocalPaths).toEqual([]);
  });

  it("does not report child entry paths as parent directory updates", async () => {
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.buildEntryMaterialization
      .mockReturnValueOnce({
        desiredKeys: new Set([
          ".config/zsh/.zshenv",
          ".config/zsh/secrets.zsh",
        ]),
        nodes: new Map(),
        type: "directory",
      })
      .mockReturnValueOnce({
        desiredKeys: new Set([".config/zsh/secrets.zsh"]),
        node: {
          contents: new Uint8Array(),
          executable: false,
          secret: true,
          type: "file",
        },
        type: "file",
      });
    mocked.countDeletedLocalNodes.mockResolvedValue(0);
    mocked.collectChangedLocalPaths
      .mockResolvedValueOnce([
        "/tmp/home/.config/zsh/.zshenv",
        "/tmp/home/.config/zsh/secrets.zsh",
      ])
      .mockResolvedValueOnce([]);

    const config = {
      age: {
        identityFile: "/tmp/devsync/keys.txt",
        recipients: ["age1recipient"],
      },
      entries: [
        {
          kind: "directory",
          localPath: "/tmp/home/.config/zsh",
          mode: "normal",
          repoPath: ".config/zsh",
        },
        {
          kind: "file",
          localPath: "/tmp/home/.config/zsh/secrets.zsh",
          mode: "secret",
          permission: 0o600,
          repoPath: ".config/zsh/secrets.zsh",
        },
      ],
      version: 7,
    };

    const plan = await buildPullPlan(config as never, "/tmp/devsync");

    expect(plan.updatedLocalPaths).toEqual(["/tmp/home/.config/zsh/.zshenv"]);
  });

  it("does not apply ignore-mode entries during pull", async () => {
    const reporter = {
      level: 3,
      start: vi.fn(),
      verbose: vi.fn(),
    } as unknown as ConsolaInstance;
    const config = {
      age: {
        identityFile: "/tmp/devsync/keys.txt",
        recipients: ["age1recipient"],
      },
      entries: [
        {
          kind: "directory",
          localPath: "/tmp/home/.config/app",
          mode: "normal",
          repoPath: ".config/app",
        },
        {
          kind: "directory",
          localPath: "/tmp/home/.config/app/node_modules",
          mode: "ignore",
          repoPath: ".config/app/node_modules",
        },
      ],
      version: 7,
    };

    mocked.ensureGitRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockResolvedValueOnce({
      effectiveConfig: config,
    });
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.buildEntryMaterialization.mockReturnValue({
      desiredKeys: new Set([".config/app"]),
      type: "absent",
    });
    mocked.countDeletedLocalNodes.mockResolvedValue(0);
    mocked.collectChangedLocalPaths.mockResolvedValue([]);

    await pullChanges({ dryRun: false }, reporter);

    expect(mocked.applyEntryMaterialization).toHaveBeenCalledTimes(1);
    expect(mocked.applyEntryMaterialization).toHaveBeenCalledWith(
      config.entries[0],
      {
        desiredKeys: new Set([".config/app"]),
        type: "absent",
      },
      config,
      reporter,
    );
    expect(reporter.start).toHaveBeenCalledWith("Applying .config/app...");
    expect(reporter.start).not.toHaveBeenCalledWith(
      "Applying .config/app/node_modules...",
    );
  });
});
