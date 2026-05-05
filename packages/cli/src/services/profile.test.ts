import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("#app/config/global-config.ts", () => ({
  formatGlobalDotweaveConfig: mock((config: unknown) =>
    JSON.stringify(config, null, 2),
  ),
  readGlobalDotweaveConfig: mock(),
}));

mock.module("#app/config/sync.ts", () => ({
  collectAllProfileNames: mock(),
  normalizeSyncProfileName: mock((profile: string) =>
    profile.trim().toLowerCase(),
  ),
  readSyncConfig: mock(),
}));

mock.module("./config-file.ts", () => ({
  buildSyncConfigDocument: mock((config: unknown) => ({
    document: config,
  })),
  writeValidatedSyncConfig: mock(),
}));

mock.module("#app/lib/filesystem.ts", () => ({
  writeTextFileAtomically: mock(),
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
  resolveSyncPaths: mock(() => ({
    configPath: "/tmp/dotweave/manifest.jsonc",
    homeDirectory: "/tmp/home",
    globalConfigPath: "/tmp/dotweave/global.json",
    syncDirectory: "/tmp/dotweave",
  })),
}));

import * as mockedGlobalConfig from "#app/config/global-config.ts";
import * as mockedSync from "#app/config/sync.ts";
import * as mockedFilesystem from "#app/lib/filesystem.ts";
import * as mockedGit from "#app/lib/git.ts";
import * as mockedConfigFile from "./config-file.ts";
import * as mockedPaths from "./paths.ts";

import {
  assignProfiles,
  clearActiveProfile,
  listProfiles,
  setActiveProfile,
} from "./profile.ts";

type MockFn = ReturnType<typeof mock>;

afterEach(() => {
  mock.clearAllMocks();
});

describe("sync profiles service", () => {
  it("lists sorted profile assignments and the active profile", async () => {
    (
      mockedGlobalConfig.readGlobalDotweaveConfig as MockFn
    ).mockResolvedValueOnce({
      activeProfile: "work",
    });
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
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
    (mockedSync.collectAllProfileNames as MockFn).mockReturnValueOnce([
      "default",
      "work",
    ]);

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
    expect(mockedGit.ensureGitRepository).toHaveBeenCalledWith("/tmp/dotweave");
  });

  it("reports no active profile when the global config is absent", async () => {
    (
      mockedGlobalConfig.readGlobalDotweaveConfig as MockFn
    ).mockResolvedValueOnce(undefined);
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [],
    });
    (mockedSync.collectAllProfileNames as MockFn).mockReturnValueOnce([]);

    const result = await listProfiles();

    expect(result.activeProfile).toBeUndefined();
    expect(result.activeProfileMode).toBe("none");
    expect(result.globalConfigExists).toBe(false);
    expect(result.assignments).toEqual([]);
  });

  it("writes a normalized active profile and warns when it is not referenced", async () => {
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [],
    });
    (mockedSync.collectAllProfileNames as MockFn).mockReturnValueOnce([
      "default",
    ]);

    await expect(setActiveProfile(" Work ")).resolves.toEqual({
      action: "use",
      activeProfile: "work",
      globalConfigPath: "/tmp/dotweave/global.json",
      profile: "work",
      syncDirectory: "/tmp/dotweave",
      warning: "Profile 'work' is not referenced by any tracked entry.",
    });
    expect(mockedGlobalConfig.formatGlobalDotweaveConfig).toHaveBeenCalledWith({
      activeProfile: "work",
      version: 3,
    });
    expect(mockedFilesystem.writeTextFileAtomically).toHaveBeenCalledWith(
      "/tmp/dotweave/global.json",
      JSON.stringify({ activeProfile: "work", version: 3 }, null, 2),
    );
  });

  it("omits the warning when activating a known profile", async () => {
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [],
    });
    (mockedSync.collectAllProfileNames as MockFn).mockReturnValueOnce(["work"]);

    const result = await setActiveProfile("work");

    expect(result.warning).toBeUndefined();
  });

  it("clears the active profile from the global config", async () => {
    await expect(clearActiveProfile()).resolves.toEqual({
      action: "clear",
      globalConfigPath: "/tmp/dotweave/global.json",
      syncDirectory: "/tmp/dotweave",
    });
    expect(mockedGlobalConfig.formatGlobalDotweaveConfig).toHaveBeenCalledWith({
      version: 3,
    });
  });

  it("rejects blank assignment targets before touching the repository", async () => {
    await expect(
      assignProfiles({ profiles: ["work"], target: "   " }, "/tmp/cwd"),
    ).rejects.toThrowError("Target path is required.");
    expect(mockedGit.ensureGitRepository).not.toHaveBeenCalled();
  });

  it("rejects assignments for untracked targets", async () => {
    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [],
    });
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(undefined);

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

    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce({
      entries: [entry],
      version: 7,
    });
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(entry);

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
    expect(mockedConfigFile.writeValidatedSyncConfig).not.toHaveBeenCalled();
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

    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce(config);
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(entry);

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
    expect(mockedConfigFile.buildSyncConfigDocument).toHaveBeenCalledWith({
      ...config,
      entries: [
        {
          ...entry,
          profiles: ["work"],
          profilesExplicit: true,
        },
      ],
    });
    expect(mockedConfigFile.writeValidatedSyncConfig).toHaveBeenCalledWith(
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

    (mockedSync.readSyncConfig as MockFn).mockResolvedValueOnce(config);
    (mockedPaths.resolveTrackedEntry as MockFn).mockReturnValueOnce(entry);

    await assignProfiles({ profiles: [], target: "~/.gitconfig" }, "/tmp/cwd");

    expect(mockedConfigFile.buildSyncConfigDocument).toHaveBeenCalledWith({
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
