import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ResolvedSyncConfigEntry,
  SyncConfigEntryKind,
  SyncMode,
} from "#app/config/sync-schema.ts";
import { doPathsOverlap } from "#app/lib/path.ts";

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
  requireGitRepository: vi.fn(),
  loadSyncConfig: vi.fn(),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/dotweave",
  })),
}));

vi.mock("#app/config/sync-schema.ts", () => ({}));

vi.mock("./pull-apply.ts", () => ({
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
  requireGitRepository: mocked.requireGitRepository,
}));

vi.mock("./sync-context.ts", () => ({
  loadSyncConfig: mocked.loadSyncConfig,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import {
  applyPullPlan,
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
  type PullPlan,
  pullChanges,
} from "./pull.ts";
import type { EffectiveSyncConfig } from "./sync-context.ts";

afterEach(() => {
  vi.clearAllMocks();
});

const createTestEntry = (
  kind: SyncConfigEntryKind,
  localPath: string,
  repoPath: string,
  mode: SyncMode,
  permission?: number,
): ResolvedSyncConfigEntry => ({
  configuredLocalPath: { default: localPath },
  configuredMode: { default: mode },
  kind,
  localPath,
  mode,
  modeExplicit: true,
  ...(permission === undefined ? {} : { permission }),
  permissionExplicit: permission !== undefined,
  profiles: [],
  profilesExplicit: false,
  repoPath,
});

const createTestConfig = (
  entries: readonly ResolvedSyncConfigEntry[] = [],
): EffectiveSyncConfig => ({
  version: 7,
  entries,
  age: {
    identityFile: "/tmp/dotweave/keys.txt",
    recipients: ["age1recipient"],
  },
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
        true,
      ),
    ).toEqual({
      decryptedFileCount: 3,
      deletedLocalCount: 4,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 2,
      symlinkCount: 0,
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

    const config = createTestConfig([
      createTestEntry(
        "directory",
        "/tmp/home/.config/app",
        ".config/app",
        "normal",
      ),
      createTestEntry(
        "directory",
        "/tmp/home/.config/app/node_modules",
        ".config/app/node_modules",
        "ignore",
      ),
    ]);

    const plan = await buildPullPlan(config, "/tmp/dotweave");

    expect(mocked.buildEntryMaterialization).toHaveBeenCalledTimes(1);
    expect(mocked.buildEntryMaterialization).toHaveBeenCalledWith(
      config.entries[0],
      expect.any(Map),
      config,
    );
    expect(mocked.countDeletedLocalNodes).toHaveBeenCalledTimes(1);
    expect(mocked.countDeletedLocalNodes).toHaveBeenCalledWith(
      config.entries[0],
      new Set([".config/app"]),
      config,
      new Set<string>(),
      new Map<string, string>(),
      new Set<string>(),
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

    const config = createTestConfig([
      createTestEntry(
        "directory",
        "/tmp/home/.config/zsh",
        ".config/zsh",
        "normal",
      ),
      createTestEntry(
        "file",
        "/tmp/home/.config/zsh/secrets.zsh",
        ".config/zsh/secrets.zsh",
        "secret",
        0o600,
      ),
    ]);

    const plan = await buildPullPlan(config, "/tmp/dotweave");

    expect(plan.updatedLocalPaths).toEqual(["/tmp/home/.config/zsh/.zshenv"]);
  });

  it("does not report deleted local paths as repository updates", async () => {
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.buildEntryMaterialization.mockReturnValueOnce({
      desiredKeys: new Set([".config/app/", ".config/app/config.json"]),
      nodes: new Map(),
      type: "directory",
    });
    mocked.countDeletedLocalNodes.mockImplementationOnce(
      async (
        _entry,
        _desiredKeys,
        _config,
        existingKeys,
        keyToLocalPath,
        deletedKeys,
      ) => {
        existingKeys.add(".config/app/");
        existingKeys.add(".config/app/config.json");
        existingKeys.add(".config/app/cache.json");
        keyToLocalPath?.set(
          ".config/app/cache.json",
          "/tmp/home/.config/app/cache.json",
        );
        deletedKeys?.add(".config/app/cache.json");
        return 1;
      },
    );
    mocked.collectChangedLocalPaths.mockResolvedValueOnce([
      "/tmp/home/.config/app/cache.json",
      "/tmp/home/.config/app/config.json",
    ]);

    const config = createTestConfig([
      createTestEntry(
        "directory",
        "/tmp/home/.config/app",
        ".config/app",
        "normal",
      ),
    ]);

    const plan = await buildPullPlan(config, "/tmp/dotweave");

    expect(plan.updatedLocalPaths).toEqual([
      "/tmp/home/.config/app/config.json",
    ]);
    expect(plan.deletedLocalPaths).toEqual([
      "/tmp/home/.config/app/cache.json",
    ]);
  });

  it("does not apply ignore-mode entries during pull", async () => {
    const config = createTestConfig([
      createTestEntry(
        "directory",
        "/tmp/home/.config/app",
        ".config/app",
        "normal",
      ),
      createTestEntry(
        "directory",
        "/tmp/home/.config/app/node_modules",
        ".config/app/node_modules",
        "ignore",
      ),
    ]);

    mocked.requireGitRepository.mockResolvedValueOnce(undefined);
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

    await pullChanges({ dryRun: false });

    expect(mocked.applyEntryMaterialization).toHaveBeenCalledTimes(1);
    expect(mocked.applyEntryMaterialization).toHaveBeenCalledWith(
      config.entries[0],
      {
        desiredKeys: new Set([".config/app"]),
        type: "absent",
      },
      config,
    );
  });

  it("does not apply overlapping local paths concurrently", async () => {
    const config = createTestConfig([
      createTestEntry(
        "directory",
        "/tmp/home/.config/zsh",
        ".config/zsh",
        "normal",
      ),
      createTestEntry(
        "file",
        "/tmp/home/.config/zsh/secrets.zsh",
        ".config/zsh/secrets.zsh",
        "secret",
        0o600,
      ),
      createTestEntry(
        "file",
        "/tmp/home/.gitconfig",
        ".gitconfig",
        "normal",
        0o644,
      ),
    ]);
    const plan: PullPlan = {
      counts: {
        decryptedFileCount: 1,
        directoryCount: 1,
        plainFileCount: 1,
        symlinkCount: 0,
      },
      deletedLocalCount: 0,
      deletedLocalPaths: [],
      desiredKeys: new Set<string>(),
      existingKeys: new Set<string>(),
      materializations: [
        {
          desiredKeys: new Set([".config/zsh/", ".config/zsh/.zshrc"]),
          nodes: new Map(),
          type: "directory",
        },
        {
          desiredKeys: new Set([".config/zsh/secrets.zsh"]),
          node: {
            contents: new Uint8Array(),
            executable: false,
            secret: true,
            type: "file",
          },
          type: "file",
        },
        {
          desiredKeys: new Set([".gitconfig"]),
          node: {
            contents: new Uint8Array(),
            executable: false,
            secret: false,
            type: "file",
          },
          type: "file",
        },
      ],
      updatedLocalPaths: [],
    };
    const activeLocalPaths: string[] = [];
    let overlapped = false;

    mocked.applyEntryMaterialization.mockImplementation(
      async (entry: { localPath: string }) => {
        if (
          activeLocalPaths.some((activeLocalPath) => {
            return doPathsOverlap(entry.localPath, activeLocalPath);
          })
        ) {
          overlapped = true;
        }

        activeLocalPaths.push(entry.localPath);
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        activeLocalPaths.splice(activeLocalPaths.indexOf(entry.localPath), 1);
      },
    );

    await applyPullPlan(config, plan);

    expect(overlapped).toBe(false);
    expect(mocked.applyEntryMaterialization).toHaveBeenCalledTimes(3);
  });
});
