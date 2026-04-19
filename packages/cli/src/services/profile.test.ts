import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  collectAllProfileNames: vi.fn(),
  buildSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  ensureGitRepository: vi.fn(),
  formatGlobalDotweaveConfig: vi.fn((config: unknown) =>
    JSON.stringify(config, null, 2),
  ),
  normalizeSyncProfileName: vi.fn((profile: string) =>
    profile.trim().toLowerCase(),
  ),
  readGlobalDotweaveConfig: vi.fn(),
  readSyncConfig: vi.fn(),
  resolveSyncConfigResolutionContext: vi.fn(() => ({
    homeDirectory: "/tmp/home",
    platformKey: "linux",
    readEnv: (_name: string) => undefined as string | undefined,
    xdgConfigHome: "/tmp/home/.config",
  })),
  resolveSyncPaths: vi.fn(() => ({
    configPath: "/tmp/dotweave/manifest.jsonc",
    homeDirectory: "/tmp/home",
    globalConfigPath: "/tmp/dotweave/global.json",
    syncDirectory: "/tmp/dotweave",
  })),
  resolveTrackedEntry: vi.fn(),
  writeTextFileAtomically: vi.fn(),
  writeValidatedSyncConfig: vi.fn(),
}));

vi.mock("#app/config/global-config.ts", () => ({
  formatGlobalDotweaveConfig: mocked.formatGlobalDotweaveConfig,
  readGlobalDotweaveConfig: mocked.readGlobalDotweaveConfig,
}));

vi.mock("#app/config/sync.ts", () => ({
  collectAllProfileNames: mocked.collectAllProfileNames,
  normalizeSyncProfileName: mocked.normalizeSyncProfileName,
  readSyncConfig: mocked.readSyncConfig,
}));

vi.mock("./config-file.ts", () => ({
  buildSyncConfigDocument: mocked.buildSyncConfigDocument,
  writeValidatedSyncConfig: mocked.writeValidatedSyncConfig,
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  writeTextFileAtomically: mocked.writeTextFileAtomically,
}));

vi.mock("./paths.ts", () => ({
  resolveTrackedEntry: mocked.resolveTrackedEntry,
}));

vi.mock("#app/lib/git.ts", () => ({
  ensureGitRepository: mocked.ensureGitRepository,
}));

vi.mock("./runtime.ts", () => ({
  resolveSyncConfigResolutionContext: mocked.resolveSyncConfigResolutionContext,
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
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce({
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
      globalConfigPath: "/tmp/dotweave/global.json",
      syncDirectory: "/tmp/dotweave",
    });
    expect(mocked.ensureGitRepository).toHaveBeenCalledWith("/tmp/dotweave");
  });

  it("reports no active profile when the global config is absent", async () => {
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce(undefined);
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
      globalConfigPath: "/tmp/dotweave/global.json",
      profile: "work",
      syncDirectory: "/tmp/dotweave",
      warning: "Profile 'work' is not referenced by any tracked entry.",
    });
    expect(mocked.formatGlobalDotweaveConfig).toHaveBeenCalledWith({
      activeProfile: "work",
      version: 3,
    });
    expect(mocked.writeTextFileAtomically).toHaveBeenCalledWith(
      "/tmp/dotweave/global.json",
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
      globalConfigPath: "/tmp/dotweave/global.json",
      syncDirectory: "/tmp/dotweave",
    });
    expect(mocked.formatGlobalDotweaveConfig).toHaveBeenCalledWith({
      version: 3,
    });
  });

  it("rejects blank assignment targets before touching the repository", async () => {
    await expect(
      assignProfiles({ profiles: ["work"], target: "   " }, "/tmp/cwd"),
    ).rejects.toThrowError("Target path is required.");
    expect(mocked.ensureGitRepository).not.toHaveBeenCalled();
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
      configPath: "/tmp/dotweave/manifest.jsonc",
      entryRepoPath: ".gitconfig",
      profiles: ["work", "default"],
      syncDirectory: "/tmp/dotweave",
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
      configPath: "/tmp/dotweave/manifest.jsonc",
      entryRepoPath: ".gitconfig",
      profiles: ["work"],
      syncDirectory: "/tmp/dotweave",
    });
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
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
      "/tmp/dotweave",
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
      expect.objectContaining({
        homeDirectory: "/tmp/home",
        platformKey: "linux",
        xdgConfigHome: "/tmp/home/.config",
      }),
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

    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
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
