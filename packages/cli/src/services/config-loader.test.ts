import { describe, expect, it, vi } from "vitest";

import { readSyncConfig } from "#app/config/sync-schema.ts";
import { ensureGitRepository } from "#app/lib/git.ts";

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

vi.mock("./runtime.ts", () => ({
  resolveSyncPaths: () => mockResolveSyncPaths,
  resolveSyncConfigResolutionContext: () => mockContext,
}));

vi.mock("#app/lib/git.ts", () => ({
  ensureGitRepository: vi.fn(),
}));

vi.mock("#app/config/sync-schema.ts", () => ({
  readSyncConfig: vi.fn(),
}));

import type { ResolvedSyncConfig } from "#app/config/sync-schema.ts";
import { loadMutableSyncConfig } from "./config-loader.ts";

describe("config-loader", () => {
  it("returns a mutable sync config on the happy path", async () => {
    const mockConfig = {
      entries: [],
      version: 7,
    } as ResolvedSyncConfig;
    vi.mocked(readSyncConfig).mockResolvedValue(mockConfig);
    vi.mocked(ensureGitRepository).mockResolvedValue(undefined);

    const result = await loadMutableSyncConfig();

    expect(result.config).toBe(mockConfig);
    expect(result.configPath).toBe(mockResolveSyncPaths.configPath);
    expect(result.context).toBe(mockContext);
    expect(result.syncDirectory).toBe(mockResolveSyncPaths.syncDirectory);
  });

  it("propagates errors from ensureGitRepository", async () => {
    const error = new Error("not a git repo");
    vi.mocked(ensureGitRepository).mockRejectedValue(error);

    await expect(loadMutableSyncConfig()).rejects.toThrow("not a git repo");
  });

  it("propagates errors from readSyncConfig", async () => {
    vi.mocked(ensureGitRepository).mockResolvedValue(undefined);
    const error = new Error("invalid config");
    vi.mocked(readSyncConfig).mockRejectedValue(error);

    await expect(loadMutableSyncConfig()).rejects.toThrow("invalid config");
  });
});
