import { beforeEach, describe, expect, it, mock } from "bun:test";
import { DotweaveError } from "#app/lib/error.ts";

mock.module("#app/lib/filesystem.ts", () => ({
  getPathStats: mock(),
}));

mock.module("#app/lib/git.ts", () => ({
  ensureGitRepository: mock(),
}));

mock.module("#app/config/sync.ts", () => ({
  readSyncConfig: mock(),
  normalizeSyncProfileName: mock((s: string) => s),
  normalizeSyncRepoPath: mock((s: string) => s),
}));

mock.module("./config-file.ts", () => ({
  buildSyncConfigDocument: mock((config: unknown) => config),
  writeValidatedSyncConfig: mock(),
}));

mock.module("./runtime.ts", () => ({
  resolveSyncConfigResolutionContext: mock(() => ({
    homeDirectory:
      process.platform === "win32" ? "C:\\home\\user" : "/home/user",
  })),
  resolveSyncPaths: mock(() => ({
    syncDirectory: "/tmp/dotweave",
    configPath: "/tmp/dotweave/manifest.jsonc",
  })),
}));

mock.module("#app/config/identity-file.ts", () => ({
  resolveDefaultIdentityFile: mock(() =>
    process.platform === "win32"
      ? "C:\\home\\user\\.ssh\\id_rsa"
      : "/home/user/.ssh/id_rsa",
  ),
}));

mock.module("#app/config/runtime-env.ts", () => ({
  readEnvValue: mock((key: string) => {
    if (key === "HOME") {
      return process.platform === "win32" ? "C:\\home\\user" : "/home/user";
    }
    if (key === "XDG_CONFIG_HOME") {
      return process.platform === "win32"
        ? "C:\\home\\user\\.config"
        : "/home/user/.config";
    }
    return undefined;
  }),
}));

mock.module("#app/lib/path.ts", () => ({
  doPathsOverlap: mock(() => false),
}));

mock.module("./paths.ts", () => ({
  buildRepoPathWithinRoot: mock((target: string, homeDirectory: string) =>
    target.slice(homeDirectory.length + 1).replaceAll("\\", "/"),
  ),
  buildConfiguredHomeLocalPath: mock((p: string) => `~/${p}`),
}));

import * as mockedSync from "#app/config/sync.ts";
import * as mockedFilesystem from "#app/lib/filesystem.ts";
import * as mockedConfigFile from "./config-file.ts";

import { trackTarget } from "./track.ts";

type MockFn = ReturnType<typeof mock>;

const bashrcPath =
  process.platform === "win32"
    ? "C:\\home\\user\\.bashrc"
    : "/home/user/.bashrc";
const homeDirectory =
  process.platform === "win32" ? "C:\\home\\user" : "/home/user";

describe("track service", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("successfully tracks a new file", async () => {
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    (mockedSync.readSyncConfig as MockFn).mockResolvedValue({
      entries: [],
      age: {},
    });

    const result = await trackTarget(
      { target: bashrcPath, mode: "normal" },
      homeDirectory,
    );

    expect(result.alreadyTracked).toBe(false);
    expect(result.changed).toBe(true);
    expect(result.localPath).toBe(bashrcPath);
    expect(mockedConfigFile.writeValidatedSyncConfig).toHaveBeenCalled();
  });

  it("throws error for missing target", async () => {
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValue(undefined);

    await expect(
      trackTarget(
        {
          target:
            process.platform === "win32"
              ? "C:\\home\\user\\missing"
              : "/home/user/missing",
          mode: "normal",
        },
        homeDirectory,
      ),
    ).rejects.toThrow(DotweaveError);
  });

  it("detects when a target is already tracked", async () => {
    const localPath = bashrcPath;
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    (mockedSync.readSyncConfig as MockFn).mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      { target: localPath, mode: "normal" },
      homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(false);
  });

  it("updates existing entry if mode changes", async () => {
    const localPath = bashrcPath;
    (mockedFilesystem.getPathStats as MockFn).mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    (mockedSync.readSyncConfig as MockFn).mockResolvedValue({
      entries: [
        {
          localPath,
          kind: "file",
          mode: "normal",
          profiles: [],
          configuredMode: { default: "normal" },
        },
      ],
      age: {},
    });

    const result = await trackTarget(
      { target: localPath, mode: "secret" },
      homeDirectory,
    );

    expect(result.alreadyTracked).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.mode).toBe("secret");
  });
});
