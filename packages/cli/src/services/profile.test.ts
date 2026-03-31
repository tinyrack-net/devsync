import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  collectAllProfileNames: vi.fn(),
  createSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  ensureSyncRepository: vi.fn(),
  formatGlobalDevsyncConfig: vi.fn((config: unknown) =>
    JSON.stringify(config, null, 2),
  ),
  normalizeSyncProfileName: vi.fn((profile: string) =>
    profile.trim().toLowerCase(),
  ),
  readGlobalDevsyncConfig: vi.fn(),
  readSyncConfig: vi.fn(),
  resolveSyncPaths: vi.fn(() => ({
    configPath: "/tmp/devsync/manifest.json",
    globalConfigPath: "/tmp/devsync/global.json",
    syncDirectory: "/tmp/devsync",
  })),
  resolveTrackedEntry: vi.fn(),
  writeTextFileAtomically: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
}));

vi.mock("#app/config/global-config.ts", () => ({
  formatGlobalDevsyncConfig: mocked.formatGlobalDevsyncConfig,
  readGlobalDevsyncConfig: mocked.readGlobalDevsyncConfig,
}));

vi.mock("#app/config/sync.ts", () => ({
  collectAllProfileNames: mocked.collectAllProfileNames,
  normalizeSyncProfileName: mocked.normalizeSyncProfileName,
  readSyncConfig: mocked.readSyncConfig,
}));

vi.mock("./config-file.ts", () => ({
  createSyncConfigDocument: mocked.createSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  writeTextFileAtomically: mocked.writeTextFileAtomically,
}));

vi.mock("./paths.ts", () => ({
  resolveTrackedEntry: mocked.resolveTrackedEntry,
}));

vi.mock("./runtime.ts", () => ({
  ensureSyncRepository: mocked.ensureSyncRepository,
  resolveSyncPaths: mocked.resolveSyncPaths,
}));

import {
  assignProfiles,
  clearActiveProfile,
  listProfiles,
  setActiveProfile,
} from "./profile.ts";

afterEach(() => {
  vi.clearAllMocks();
});

describe("sync profiles service", () => {
  it("lists sorted profile assignments and the active profile", async () => {
    mocked.readGlobalDevsyncConfig.mockResolvedValueOnce({
      activeProfile: "work",
    });
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [
        {
          localPath: "/tmp/home/.zshrc",
          profiles: ["work"],
          profilesExplicit: true,
          repoPath: ".zshrc",
        },
        {
          localPath: "/tmp/home/.bashrc",
          profiles: [],
          profilesExplicit: false,
          repoPath: ".bashrc",
        },
        {
          localPath: "/tmp/home/.gitconfig",
          profiles: ["default", "work"],
          profilesExplicit: true,
          repoPath: ".gitconfig",
        },
      ],
    });
    mocked.collectAllProfileNames.mockReturnValueOnce(["default", "work"]);

    await expect(listProfiles()).resolves.toEqual({
      activeProfile: "work",
      activeProfileMode: "single",
      assignments: [
        {
          entryLocalPath: "/tmp/home/.gitconfig",
          entryRepoPath: ".gitconfig",
          profiles: ["default", "work"],
        },
        {
          entryLocalPath: "/tmp/home/.zshrc",
          entryRepoPath: ".zshrc",
          profiles: ["work"],
        },
      ],
      availableProfiles: ["default", "work"],
      globalConfigExists: true,
      globalConfigPath: "/tmp/devsync/global.json",
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.ensureSyncRepository).toHaveBeenCalledWith("/tmp/devsync");
  });

  it("reports no active profile when the global config is absent", async () => {
    mocked.readGlobalDevsyncConfig.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [],
    });
    mocked.collectAllProfileNames.mockReturnValueOnce([]);

    const result = await listProfiles();

    expect(result.activeProfile).toBeUndefined();
    expect(result.activeProfileMode).toBe("none");
    expect(result.globalConfigExists).toBe(false);
    expect(result.assignments).toEqual([]);
  });

  it("writes a normalized active profile and warns when it is not referenced", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [],
    });
    mocked.collectAllProfileNames.mockReturnValueOnce(["default"]);

    await expect(setActiveProfile(" Work ")).resolves.toEqual({
      action: "use",
      activeProfile: "work",
      globalConfigPath: "/tmp/devsync/global.json",
      profile: "work",
      syncDirectory: "/tmp/devsync",
      warning: "Profile 'work' is not referenced by any tracked entry.",
    });
    expect(mocked.formatGlobalDevsyncConfig).toHaveBeenCalledWith({
      activeProfile: "work",
      version: 3,
    });
    expect(mocked.writeTextFileAtomically).toHaveBeenCalledWith(
      "/tmp/devsync/global.json",
      JSON.stringify({ activeProfile: "work", version: 3 }, null, 2),
    );
  });

  it("omits the warning when activating a known profile", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [],
    });
    mocked.collectAllProfileNames.mockReturnValueOnce(["work"]);

    const result = await setActiveProfile("work");

    expect(result.warning).toBeUndefined();
  });

  it("clears the active profile from the global config", async () => {
    await expect(clearActiveProfile()).resolves.toEqual({
      action: "clear",
      globalConfigPath: "/tmp/devsync/global.json",
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.formatGlobalDevsyncConfig).toHaveBeenCalledWith({
      version: 3,
    });
  });

  it("rejects blank assignment targets before touching the repository", async () => {
    await expect(
      assignProfiles({ profiles: ["work"], target: "   " }, "/tmp/cwd"),
    ).rejects.toThrowError("Target path is required.");
    expect(mocked.ensureSyncRepository).not.toHaveBeenCalled();
  });

  it("rejects assignments for untracked targets", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [],
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(undefined);

    await expect(
      assignProfiles(
        { profiles: ["work"], target: "~/.gitconfig" },
        "/tmp/cwd",
      ),
    ).rejects.toThrowError("No tracked sync entry matches: ~/.gitconfig");
  });

  it("returns unchanged when the normalized profiles already match", async () => {
    const entry = {
      profiles: ["default", "work"],
      repoPath: ".gitconfig",
    };

    mocked.readSyncConfig.mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    await expect(
      assignProfiles(
        { profiles: [" WORK ", "default"], target: "~/.gitconfig" },
        "/tmp/cwd",
      ),
    ).resolves.toEqual({
      action: "unchanged",
      configPath: "/tmp/devsync/manifest.json",
      entryRepoPath: ".gitconfig",
      profiles: ["work", "default"],
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });

  it("updates tracked profiles and marks them explicit when profiles are supplied", async () => {
    const entry = {
      profiles: ["default"],
      profilesExplicit: true,
      repoPath: ".gitconfig",
    };
    const config = {
      entries: [entry],
      version: 7,
    };

    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await assignProfiles(
      { profiles: ["work"], target: "~/.gitconfig" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      action: "assigned",
      configPath: "/tmp/devsync/manifest.json",
      entryRepoPath: ".gitconfig",
      profiles: ["work"],
      syncDirectory: "/tmp/devsync",
    });
    expect(mocked.createSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        {
          ...entry,
          profiles: ["work"],
          profilesExplicit: true,
        },
      ],
    });
    expect(mocked.writeValidatedSyncConfig).toHaveBeenCalledWith(
      "/tmp/devsync",
      {
        document: {
          ...config,
          entries: [
            {
              ...entry,
              profiles: ["work"],
              profilesExplicit: true,
            },
          ],
        },
      },
    );
  });

  it("clears explicit profiles when assigning an empty profile list", async () => {
    const entry = {
      profiles: ["work"],
      profilesExplicit: true,
      repoPath: ".gitconfig",
    };
    const config = {
      entries: [entry],
      version: 7,
    };

    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    await assignProfiles({ profiles: [], target: "~/.gitconfig" }, "/tmp/cwd");

    expect(mocked.createSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        {
          ...entry,
          profiles: [],
          profilesExplicit: false,
        },
      ],
    });
  });
});
