import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockReadEnv } from "#test/helpers/mock-factories.ts";

const mocked = vi.hoisted(() => ({
  buildSyncConfigDocument: vi.fn((config: unknown) => ({
    document: config,
  })),
  requireGitRepository: vi.fn(),
  formatGlobalDotweaveConfig: vi.fn((config: unknown) =>
    JSON.stringify(config, null, 2),
  ),
  normalizeSyncProfileName: vi.fn((profile: string) => profile.trim()),
  readGlobalDotweaveConfig: vi.fn(),
  resolveActiveProfileSelection: vi.fn((config) =>
    config?.activeProfile === undefined
      ? { mode: "none" }
      : { mode: "single", profile: config.activeProfile },
  ),
  isProfileActive: vi.fn((selection, profile) =>
    selection.mode === "single" && profile !== undefined
      ? selection.profile === profile
      : false,
  ),
  readSyncConfig: vi.fn(),
  resolveSyncConfigResolutionContext: vi.fn(() => ({
    homeDirectory: "/tmp/home",
    platformKey: "linux",
    readEnv: createMockReadEnv(),
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
  isProfileActive: mocked.isProfileActive,
  readGlobalDotweaveConfig: mocked.readGlobalDotweaveConfig,
  resolveActiveProfileSelection: mocked.resolveActiveProfileSelection,
}));

vi.mock("#app/config/sync-schema.ts", () => ({
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

import {
  addProfile,
  assignProfiles,
  clearActiveProfile,
  listProfiles,
  removeProfile,
  setActiveProfile,
  validateProfilesExist,
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
      profiles: ["work"],
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
    });
    expect(mocked.requireGitRepository).toHaveBeenCalledWith("/tmp/dotweave");
  });

  it("reports no active profile when the global config is absent", async () => {
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce(undefined);
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: [],
      entries: [],
    });

    const result = await listProfiles();

    expect(result.activeProfile).toBeUndefined();
    expect(result.activeProfileMode).toBe("none");
    expect(result.globalConfigExists).toBe(false);
    expect(result.assignments).toEqual([]);
  });

  it("warns when the active profile is not registered", async () => {
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce({
      activeProfile: "ghost",
    });
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: ["work"],
      entries: [],
    });

    await expect(listProfiles()).resolves.toMatchObject({
      activeProfile: "ghost",
      activeProfileWarning:
        "Active profile 'ghost' is not registered in manifest.jsonc.",
    });
  });

  it("writes a trimmed active profile without changing case when it exists", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: ["Work"],
      entries: [],
    });

    await expect(setActiveProfile(" Work ")).resolves.toEqual({
      action: "use",
      activeProfile: "Work",
      globalConfigPath: "/tmp/dotweave/global.json",
      profile: "Work",
    });
    expect(mocked.formatGlobalDotweaveConfig).toHaveBeenCalledWith({
      activeProfile: "Work",
      version: 3,
    });
    expect(mocked.writeTextFileAtomically).toHaveBeenCalledWith(
      "/tmp/dotweave/global.json",
      JSON.stringify({ activeProfile: "Work", version: 3 }, null, 2),
    );
  });

  it("rejects activating an unknown profile", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: [],
      entries: [],
    });

    await expect(setActiveProfile("work")).rejects.toThrowError(
      "Unknown profile 'work'.",
    );
  });

  it("adds a trimmed profile to the manifest registry without changing case", async () => {
    const config = {
      profiles: [],
      entries: [],
      version: 8,
    };
    mocked.readSyncConfig.mockResolvedValueOnce(config);

    await expect(addProfile(" Work ")).resolves.toEqual({
      action: "added",
      profile: "Work",
    });
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      profiles: ["Work"],
    });
  });

  it("sorts the manifest registry when adding a profile", async () => {
    const config = {
      profiles: ["work"],
      entries: [],
      version: 8,
    };
    mocked.readSyncConfig.mockResolvedValueOnce(config);

    await expect(addProfile("alpha")).resolves.toEqual({
      action: "added",
      profile: "alpha",
    });
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      profiles: ["alpha", "work"],
    });
  });

  it("rejects duplicate profile additions", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: ["work"],
      entries: [],
      version: 8,
    });

    await expect(addProfile("work")).rejects.toThrowError(
      "Profile 'work' already exists.",
    );
  });

  it("rejects removing the active profile", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: ["work"],
      entries: [],
      version: 8,
    });
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce({
      activeProfile: "work",
      version: 3,
    });

    await expect(removeProfile("work")).rejects.toThrowError(
      "Cannot remove active profile 'work'.",
    );
  });

  it("removes an unused profile from the manifest registry", async () => {
    const entry = {
      profiles: ["personal"],
      profilesExplicit: true,
      repoPath: ".gitconfig",
    };
    const config = {
      profiles: ["work", "personal"],
      entries: [entry],
      version: 8,
    };
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce(undefined);

    await expect(removeProfile("work")).resolves.toEqual({
      action: "removed",
      profile: "work",
    });
    expect(mocked.buildSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      profiles: ["personal"],
    });
  });

  it("rejects removing a profile that is still referenced by entries", async () => {
    const config = {
      profiles: ["work", "personal"],
      entries: [
        {
          profiles: ["work"],
          profilesExplicit: true,
          repoPath: ".config/workapp",
        },
        {
          profiles: ["personal"],
          profilesExplicit: true,
          repoPath: ".gitconfig",
        },
      ],
      version: 8,
    };
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce(undefined);

    await expect(removeProfile("work")).rejects.toThrowError(
      "Cannot remove profile 'work' because it is still referenced by 1 sync entry.",
    );
    expect(mocked.buildSyncConfigDocument).not.toHaveBeenCalled();
  });

  it("rejects removing a profile inherited by child entries", async () => {
    const config = {
      profiles: ["work"],
      entries: [
        {
          profiles: ["work"],
          profilesExplicit: false,
          repoPath: ".config/workapp/config.toml",
        },
      ],
      version: 8,
    };
    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.readGlobalDotweaveConfig.mockResolvedValueOnce(undefined);

    await expect(removeProfile("work")).rejects.toThrowError(
      "Cannot remove profile 'work' because it is still referenced by 1 sync entry.",
    );
    expect(mocked.buildSyncConfigDocument).not.toHaveBeenCalled();
  });

  it("validates requested profiles without writing assignments", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: ["Work"],
      entries: [],
      version: 8,
    });

    await expect(validateProfilesExist([" Work "])).resolves.toEqual(["Work"]);
    expect(mocked.buildSyncConfigDocument).not.toHaveBeenCalled();
    expect(mocked.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });

  it("rejects unknown profiles during validation without writing assignments", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: [],
      entries: [],
      version: 8,
    });

    await expect(validateProfilesExist(["ghost"])).rejects.toThrowError(
      "Unknown profile 'ghost'.",
    );
    expect(mocked.buildSyncConfigDocument).not.toHaveBeenCalled();
    expect(mocked.writeValidatedSyncConfig).not.toHaveBeenCalled();
  });

  it("clears the active profile from the global config", async () => {
    await expect(clearActiveProfile()).resolves.toEqual({
      action: "clear",
      globalConfigPath: "/tmp/dotweave/global.json",
    });
    expect(mocked.formatGlobalDotweaveConfig).toHaveBeenCalledWith({
      version: 3,
    });
  });

  it("rejects blank assignment targets before touching the repository", async () => {
    await expect(
      assignProfiles({ profiles: ["work"], target: "   " }, "/tmp/cwd"),
    ).rejects.toThrowError("Target path is required.");
    expect(mocked.requireGitRepository).not.toHaveBeenCalled();
  });

  it("rejects assignments for untracked targets", async () => {
    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: [],
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

  it("returns unchanged when the trimmed profiles already match", async () => {
    const entry = {
      profiles: ["default", "work"],
      repoPath: ".gitconfig",
    };

    mocked.readSyncConfig.mockResolvedValueOnce({
      profiles: ["work"],
      entries: [entry],
      version: 8,
    });
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    await expect(
      assignProfiles(
        { profiles: [" work ", "default"], target: "~/.gitconfig" },
        "/tmp/cwd",
      ),
    ).resolves.toEqual({
      action: "unchanged",
      entryRepoPath: ".gitconfig",
      profiles: ["work", "default"],
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
      profiles: ["work"],
      entries: [entry],
      version: 8,
    };

    mocked.readSyncConfig.mockResolvedValueOnce(config);
    mocked.resolveTrackedEntry.mockReturnValueOnce(entry);

    const result = await assignProfiles(
      { profiles: ["work"], target: "~/.gitconfig" },
      "/tmp/cwd",
    );

    expect(result).toEqual({
      action: "assigned",
      entryRepoPath: ".gitconfig",
      profiles: ["work"],
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
    );
  });

  it("clears explicit profiles when assigning an empty profile list", async () => {
    const entry = {
      profiles: ["work"],
      profilesExplicit: true,
      repoPath: ".gitconfig",
    };
    const config = {
      profiles: ["work"],
      entries: [entry],
      version: 8,
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
