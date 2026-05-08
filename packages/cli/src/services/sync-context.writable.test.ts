import { describe, expect, it, vi } from "vitest";

import { readSyncConfig } from "#app/config/sync-schema.ts";
import { requireGitRepository } from "#app/lib/git.ts";

const mockResolveSyncPaths = vi.hoisted(() => ({
  syncDirectory: "/tmp/dotweave-sync",
  configPath: "/tmp/dotweave-sync/manifest.jsonc",
}));

const mockContext = vi.hoisted(() => ({
  homeDirectory: "/home/test",
  platformKey: "linux" as const,
  readEnv: vi.fn(),
  xdgConfigHome: "/home/test/.config",
}));

vi.mock("#app/lib/git.ts", () => ({
  requireGitRepository: vi.fn(),
}));

vi.mock("#app/config/sync-schema.ts", () => ({
  readSyncConfig: vi.fn(),
}));

vi.mock("./sync-context.ts", () => {
  const loadWritableSyncConfig = vi.fn(async () => {
    await requireGitRepository(mockResolveSyncPaths.syncDirectory);
    const config = await readSyncConfig(
      mockResolveSyncPaths.syncDirectory,
      mockContext,
    );
    return {
      config,
      configPath: mockResolveSyncPaths.configPath,
      context: mockContext,
      syncDirectory: mockResolveSyncPaths.syncDirectory,
    };
  });

  return {
    resolveSyncPaths: () => mockResolveSyncPaths,
    resolveSyncConfigResolutionContext: () => mockContext,
    loadWritableSyncConfig,
  };
});

import type { ResolvedSyncConfig } from "#app/config/sync-schema.ts";
import { loadWritableSyncConfig } from "./sync-context.ts";

describe("sync-context (loadWritableSyncConfig)", () => {
  it("returns a mutable sync config on the happy path", async () => {
    const mockConfig = {
      entries: [],
      version: 7,
    } as ResolvedSyncConfig;
    vi.mocked(readSyncConfig).mockResolvedValue(mockConfig);
    vi.mocked(requireGitRepository).mockResolvedValue(undefined);

    const result = await loadWritableSyncConfig();

    expect(result.config).toBe(mockConfig);
    expect(result.configPath).toBe(mockResolveSyncPaths.configPath);
    expect(result.context).toBe(mockContext);
    expect(result.syncDirectory).toBe(mockResolveSyncPaths.syncDirectory);
  });

  it("propagates errors from requireGitRepository", async () => {
    const error = new Error("not a git repo");
    vi.mocked(requireGitRepository).mockRejectedValue(error);

    await expect(loadWritableSyncConfig()).rejects.toThrow("not a git repo");
  });

  it("propagates errors from readSyncConfig", async () => {
    vi.mocked(requireGitRepository).mockResolvedValue(undefined);
    const error = new Error("invalid config");
    vi.mocked(readSyncConfig).mockRejectedValue(error);

    await expect(loadWritableSyncConfig()).rejects.toThrow("invalid config");
  });

  it("loadWritableSyncConfig resolves context and paths", async () => {
    const mockConfig = {
      entries: [],
      version: 7,
    } as ResolvedSyncConfig;
    vi.mocked(readSyncConfig).mockResolvedValue(mockConfig);
    vi.mocked(requireGitRepository).mockResolvedValue(undefined);

    const result = await loadWritableSyncConfig();

    expect(result.context).toBe(mockContext);
    expect(result.syncDirectory).toBe(mockResolveSyncPaths.syncDirectory);
    expect(result.configPath).toBe(mockResolveSyncPaths.configPath);
  });

  it("loadWritableSyncConfig returns the parsed config from readSyncConfig", async () => {
    const mockConfig = {
      entries: [],
      version: 7,
    } as ResolvedSyncConfig;
    vi.mocked(readSyncConfig).mockResolvedValue(mockConfig);
    vi.mocked(requireGitRepository).mockResolvedValue(undefined);

    const result = await loadWritableSyncConfig();

    expect(result.config).toBe(mockConfig);
  });
});
