import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  buildRepositorySnapshot: vi.fn(),
  ensureRepository: vi.fn(),
  loadSyncConfig: vi.fn(),
  pathExists: vi.fn(),
  resolveSyncConfigFilePath: vi.fn(
    (syncDirectory: string) => `${syncDirectory}/manifest.json`,
  ),
  resolveSyncPaths: vi.fn(() => ({
    syncDirectory: "/tmp/devsync",
  })),
}));

vi.mock("#app/config/sync.ts", () => ({
  resolveSyncConfigFilePath: mocked.resolveSyncConfigFilePath,
}));

vi.mock("./filesystem.ts", () => ({
  pathExists: mocked.pathExists,
}));

vi.mock("./git.ts", () => ({
  ensureRepository: mocked.ensureRepository,
}));

vi.mock("./repo-snapshot.ts", () => ({
  buildRepositorySnapshot: mocked.buildRepositorySnapshot,
}));

vi.mock("./runtime.ts", () => ({
  loadSyncConfig: mocked.loadSyncConfig,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import { runSyncDoctor } from "./doctor.ts";

const createReporter = (verbose = false) => ({
  detail: vi.fn(),
  phase: vi.fn(),
  verbose,
});

const createLoadedConfig = (options: {
  activeProfile?: string;
  entryLocalPaths: readonly string[];
  entryModes?: readonly ("normal" | "secret" | "ignore")[];
  identityFile?: string;
  recipientCount?: number;
}) => {
  const identityFile = options.identityFile ?? "/tmp/devsync/keys.txt";
  const entries = options.entryLocalPaths.map((localPath, index) => ({
    mode: options.entryModes?.[index] ?? "normal",
    localPath,
    repoPath: `.config/item-${index}`,
  }));

  return {
    effectiveConfig: {
      age: {
        configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        identityFile,
        recipients: Array.from(
          { length: options.recipientCount ?? 1 },
          (_, index) => `age1recipient${index}`,
        ),
      },
      entries,
      version: 7,
      ...(options.activeProfile === undefined
        ? {}
        : { activeProfile: options.activeProfile }),
    },
    fullConfig: {
      entries,
      version: 7,
    },
  };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("sync doctor", () => {
  it("returns an immediate git failure when the sync directory is not a repository", async () => {
    mocked.ensureRepository.mockRejectedValueOnce("not-a-repo");
    const reporter = createReporter();

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, reporter);

    expect(result).toEqual({
      checks: [
        {
          checkId: "git",
          detail: "Git repository check failed.",
          level: "fail",
        },
      ],
      configPath: "/tmp/devsync/manifest.json",
      hasFailures: true,
      hasWarnings: false,
      syncDirectory: "/tmp/devsync",
    });
    expect(reporter.phase.mock.calls).toEqual([
      ["Running doctor checks..."],
      ["Checking sync repository..."],
    ]);
    expect(mocked.loadSyncConfig).not.toHaveBeenCalled();
  });

  it("returns a configuration failure after a successful repository check", async () => {
    mocked.ensureRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockRejectedValueOnce(
      new Error("manifest is invalid"),
    );
    const reporter = createReporter();

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, reporter);

    expect(result).toEqual({
      checks: [
        {
          checkId: "git",
          detail: "Sync directory is a git repository.",
          level: "ok",
        },
        {
          checkId: "config",
          detail: "manifest is invalid",
          level: "fail",
        },
      ],
      configPath: "/tmp/devsync/manifest.json",
      hasFailures: true,
      hasWarnings: false,
      syncDirectory: "/tmp/devsync",
    });
    expect(reporter.phase.mock.calls).toEqual([
      ["Running doctor checks..."],
      ["Checking sync repository..."],
      ["Loading sync configuration..."],
    ]);
  });

  it("reports verbose details, a missing identity, and a singular missing local path warning", async () => {
    mocked.ensureRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockResolvedValueOnce(
      createLoadedConfig({
        entryLocalPaths: ["/tmp/home/.ssh/id_ed25519"],
      }),
    );
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.pathExists.mockImplementation(async (path: string) => {
      return (
        path !== "/tmp/devsync/keys.txt" && path !== "/tmp/home/.ssh/id_ed25519"
      );
    });
    const reporter = createReporter(true);

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, reporter);

    expect(result.hasFailures).toBe(true);
    expect(result.hasWarnings).toBe(true);
    expect(result.checks).toEqual([
      {
        checkId: "git",
        detail: "Sync directory is a git repository.",
        level: "ok",
      },
      {
        checkId: "config",
        detail: "Loaded config with 1 entries and 1 recipients.",
        level: "ok",
      },
      {
        checkId: "profiles",
        detail: "No active profile configured.",
        level: "ok",
      },
      {
        checkId: "age",
        detail: "Age identity file is missing: /tmp/devsync/keys.txt",
        level: "fail",
      },
      {
        checkId: "entries",
        detail: "Tracked 1 sync entries.",
        level: "ok",
      },
      {
        checkId: "local-paths",
        detail: "1 tracked local path is missing.",
        level: "warn",
      },
    ]);
    expect(reporter.detail).toHaveBeenCalledWith(
      "checked tracked local path /tmp/home/.ssh/id_ed25519",
    );
    expect(reporter.phase.mock.calls).toEqual([
      ["Running doctor checks..."],
      ["Checking sync repository..."],
      ["Loading sync configuration..."],
      ["Checking age identity..."],
      ["Scanning repository artifacts..."],
      ["Checking tracked local paths..."],
    ]);
    expect(mocked.pathExists).toHaveBeenCalledWith("/tmp/devsync/keys.txt");
    expect(mocked.pathExists).toHaveBeenCalledWith("/tmp/home/.ssh/id_ed25519");
  });

  it("reports batch progress and plural missing-path warnings when many entries are checked", async () => {
    mocked.ensureRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockResolvedValueOnce(
      createLoadedConfig({
        activeProfile: "work",
        entryLocalPaths: [
          ...Array.from({ length: 98 }, (_, index) => `/tmp/present-${index}`),
          "/tmp/missing-a",
          "/tmp/missing-b",
        ],
        recipientCount: 2,
      }),
    );
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.pathExists.mockImplementation(async (path: string) => {
      return path !== "/tmp/missing-a" && path !== "/tmp/missing-b";
    });
    const reporter = createReporter(false);

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, reporter);

    expect(result.hasFailures).toBe(false);
    expect(result.hasWarnings).toBe(true);
    expect(result.checks).toContainEqual({
      checkId: "profiles",
      detail: "Active profile: work.",
      level: "ok",
    });
    expect(result.checks).toContainEqual({
      checkId: "age",
      detail: "Age identity file exists at /tmp/devsync/keys.txt.",
      level: "ok",
    });
    expect(result.checks).toContainEqual({
      checkId: "entries",
      detail: "Tracked 100 sync entries.",
      level: "ok",
    });
    expect(result.checks).toContainEqual({
      checkId: "local-paths",
      detail: "2 tracked local paths are missing.",
      level: "warn",
    });
    expect(reporter.detail).not.toHaveBeenCalled();
    expect(reporter.phase).toHaveBeenCalledWith(
      "Checked 100 tracked local paths...",
    );
  });

  it("warns when no entries are configured and still reports healthy local paths", async () => {
    mocked.ensureRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockResolvedValueOnce(
      createLoadedConfig({
        entryLocalPaths: [],
      }),
    );
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.pathExists.mockResolvedValueOnce(true);

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, createReporter());

    expect(result.hasFailures).toBe(false);
    expect(result.hasWarnings).toBe(true);
    expect(result.checks).toContainEqual({
      checkId: "entries",
      detail: "No sync entries are configured yet.",
      level: "warn",
    });
    expect(result.checks).toContainEqual({
      checkId: "local-paths",
      detail: "All tracked local paths currently exist.",
      level: "ok",
    });
    expect(mocked.pathExists).toHaveBeenCalledTimes(1);
  });

  it("does not warn when missing local paths are already restorable from the sync repository", async () => {
    mocked.ensureRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockResolvedValueOnce(
      createLoadedConfig({
        entryLocalPaths: ["/tmp/home/.gitconfig"],
      }),
    );
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(
      new Map([[".config/item-0", { type: "file" }]]),
    );
    mocked.pathExists.mockImplementation(async (path: string) => {
      return path === "/tmp/devsync/keys.txt";
    });

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, createReporter());

    expect(result.hasWarnings).toBe(false);
    expect(result.checks).toContainEqual({
      checkId: "local-paths",
      detail:
        "All missing local paths are already restorable from the sync repository (1 entry).",
      level: "ok",
    });
  });

  it("skips ignore-mode entries when checking missing local paths", async () => {
    mocked.ensureRepository.mockResolvedValueOnce(undefined);
    mocked.loadSyncConfig.mockResolvedValueOnce(
      createLoadedConfig({
        entryLocalPaths: ["/tmp/missing-ignore", "/tmp/missing-normal"],
        entryModes: ["ignore", "normal"],
      }),
    );
    mocked.buildRepositorySnapshot.mockResolvedValueOnce(new Map());
    mocked.pathExists.mockImplementation(async (path: string) => {
      return path === "/tmp/devsync/keys.txt";
    });

    const result = await runSyncDoctor({ HOME: "/tmp/home" }, createReporter());

    expect(result.checks).toContainEqual({
      checkId: "local-paths",
      detail: "1 tracked local path is missing.",
      level: "warn",
    });
    expect(mocked.pathExists).not.toHaveBeenCalledWith("/tmp/missing-ignore");
    expect(mocked.pathExists).toHaveBeenCalledWith("/tmp/missing-normal");
  });
});
