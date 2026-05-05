import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ConsolaInstance } from "consola";
import { doPathsOverlap } from "#app/lib/path.ts";

mock.module("#app/config/sync.ts", () => ({
  resolveSyncConfigFilePath: mock(
    (syncDirectory: string) => `${syncDirectory}/manifest.jsonc`,
  ),
}));

mock.module("./local-materialization.ts", () => ({
  applyEntryMaterialization: mock(),
  buildEntryMaterialization: mock(),
  buildPullCounts: mock(() => ({
    decryptedFileCount: 0,
    directoryCount: 0,
    plainFileCount: 0,
    symlinkCount: 0,
  })),
  collectChangedLocalPaths: mock(),
  countDeletedLocalNodes: mock(),
}));

mock.module("./repo-snapshot.ts", () => ({
  buildRepositorySnapshot: mock(),
}));

mock.module("#app/lib/git.ts", () => ({
  ensureGitRepository: mock(),
}));

mock.module("./runtime.ts", () => ({
  loadSyncConfig: mock(),
  resolveSyncPaths: mock(() => ({
    syncDirectory: "/tmp/dotweave",
  })),
}));

import * as mockedGit from "#app/lib/git.ts";
import * as mockedLocalMaterialization from "./local-materialization.ts";
import {
  applyPullPlan,
  buildPullPlan,
  buildPullPlanPreview,
  buildPullResultFromPlan,
  pullChanges,
} from "./pull.ts";
import * as mockedRepoSnapshot from "./repo-snapshot.ts";
import * as mockedRuntime from "./runtime.ts";

type MockFn = ReturnType<typeof mock>;

afterEach(() => {
  mock.clearAllMocks();
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
        "/tmp/dotweave",
        true,
      ),
    ).toEqual({
      configPath: "/tmp/dotweave/manifest.jsonc",
      decryptedFileCount: 3,
      deletedLocalCount: 4,
      directoryCount: 1,
      dryRun: true,
      plainFileCount: 2,
      symlinkCount: 0,
      syncDirectory: "/tmp/dotweave",
    });
  });
});

describe("pull planning", () => {
  it("skips ignore-mode entries while planning materializations", async () => {
    (
      mockedRepoSnapshot.buildRepositorySnapshot as MockFn
    ).mockResolvedValueOnce(new Map());
    (
      mockedLocalMaterialization.buildEntryMaterialization as MockFn
    ).mockReturnValue({
      desiredKeys: new Set([".config/app"]),
      type: "absent",
    });
    (
      mockedLocalMaterialization.countDeletedLocalNodes as MockFn
    ).mockResolvedValue(0);
    (
      mockedLocalMaterialization.collectChangedLocalPaths as MockFn
    ).mockResolvedValue([]);

    const config = {
      age: {
        identityFile: "/tmp/dotweave/keys.txt",
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

    const plan = await buildPullPlan(config as never, "/tmp/dotweave");

    expect(
      mockedLocalMaterialization.buildEntryMaterialization,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockedLocalMaterialization.buildEntryMaterialization,
    ).toHaveBeenCalledWith(
      config.entries[0],
      expect.any(Map),
      config,
      undefined,
    );
    expect(
      mockedLocalMaterialization.countDeletedLocalNodes,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockedLocalMaterialization.countDeletedLocalNodes,
    ).toHaveBeenCalledWith(
      config.entries[0],
      new Set([".config/app"]),
      config,
      new Set<string>(),
      undefined,
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
    (
      mockedRepoSnapshot.buildRepositorySnapshot as MockFn
    ).mockResolvedValueOnce(new Map());
    (mockedLocalMaterialization.buildEntryMaterialization as MockFn)
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
    (
      mockedLocalMaterialization.countDeletedLocalNodes as MockFn
    ).mockResolvedValue(0);
    (mockedLocalMaterialization.collectChangedLocalPaths as MockFn)
      .mockResolvedValueOnce([
        "/tmp/home/.config/zsh/.zshenv",
        "/tmp/home/.config/zsh/secrets.zsh",
      ])
      .mockResolvedValueOnce([]);

    const config = {
      age: {
        identityFile: "/tmp/dotweave/keys.txt",
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

    const plan = await buildPullPlan(config as never, "/tmp/dotweave");

    expect(plan.updatedLocalPaths).toEqual(["/tmp/home/.config/zsh/.zshenv"]);
  });

  it("does not report deleted local paths as repository updates", async () => {
    (
      mockedRepoSnapshot.buildRepositorySnapshot as MockFn
    ).mockResolvedValueOnce(new Map());
    (
      mockedLocalMaterialization.buildEntryMaterialization as MockFn
    ).mockReturnValueOnce({
      desiredKeys: new Set([".config/app/", ".config/app/config.json"]),
      nodes: new Map(),
      type: "directory",
    });
    (
      mockedLocalMaterialization.countDeletedLocalNodes as MockFn
    ).mockImplementationOnce(
      async (
        _entry: unknown,
        _desiredKeys: unknown,
        _config: unknown,
        existingKeys: Set<string>,
        _reporter: unknown,
        keyToLocalPath: Map<string, string>,
        deletedKeys: Set<string>,
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
    (
      mockedLocalMaterialization.collectChangedLocalPaths as MockFn
    ).mockResolvedValueOnce([
      "/tmp/home/.config/app/cache.json",
      "/tmp/home/.config/app/config.json",
    ]);

    const config = {
      age: {
        identityFile: "/tmp/dotweave/keys.txt",
        recipients: ["age1recipient"],
      },
      entries: [
        {
          kind: "directory",
          localPath: "/tmp/home/.config/app",
          mode: "normal",
          repoPath: ".config/app",
        },
      ],
      version: 7,
    };

    const plan = await buildPullPlan(config as never, "/tmp/dotweave");

    expect(plan.updatedLocalPaths).toEqual([
      "/tmp/home/.config/app/config.json",
    ]);
    expect(plan.deletedLocalPaths).toEqual([
      "/tmp/home/.config/app/cache.json",
    ]);
  });

  it("does not apply ignore-mode entries during pull", async () => {
    const reporter = {
      level: 3,
      start: mock(),
      verbose: mock(),
    } as unknown as ConsolaInstance;
    const config = {
      age: {
        identityFile: "/tmp/dotweave/keys.txt",
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

    (mockedGit.ensureGitRepository as MockFn).mockResolvedValueOnce(undefined);
    (mockedRuntime.loadSyncConfig as MockFn).mockResolvedValueOnce({
      effectiveConfig: config,
    });
    (
      mockedRepoSnapshot.buildRepositorySnapshot as MockFn
    ).mockResolvedValueOnce(new Map());
    (
      mockedLocalMaterialization.buildEntryMaterialization as MockFn
    ).mockReturnValue({
      desiredKeys: new Set([".config/app"]),
      type: "absent",
    });
    (
      mockedLocalMaterialization.countDeletedLocalNodes as MockFn
    ).mockResolvedValue(0);
    (
      mockedLocalMaterialization.collectChangedLocalPaths as MockFn
    ).mockResolvedValue([]);

    await pullChanges({ dryRun: false }, reporter);

    expect(
      mockedLocalMaterialization.applyEntryMaterialization,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockedLocalMaterialization.applyEntryMaterialization,
    ).toHaveBeenCalledWith(
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

  it("does not apply overlapping local paths concurrently", async () => {
    const config = {
      age: {
        identityFile: "/tmp/dotweave/keys.txt",
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
        {
          kind: "file",
          localPath: "/tmp/home/.gitconfig",
          mode: "normal",
          permission: 0o644,
          repoPath: ".gitconfig",
        },
      ],
      version: 7,
    };
    const plan = {
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

    (
      mockedLocalMaterialization.applyEntryMaterialization as MockFn
    ).mockImplementation(async (entry: { localPath: string }) => {
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
    });

    await applyPullPlan(config as never, plan as never);

    expect(overlapped).toBe(false);
    expect(
      mockedLocalMaterialization.applyEntryMaterialization,
    ).toHaveBeenCalledTimes(3);
  });
});
