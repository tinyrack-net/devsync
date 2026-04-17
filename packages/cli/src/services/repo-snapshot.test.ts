import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRepositorySnapshot } from "./repo-snapshot.ts";

const mocked = vi.hoisted(() => ({
  getPathStats: vi.fn(),
  listDirectoryEntries: vi.fn(),
  lstat: vi.fn(),
  readFile: vi.fn(),
  readlink: vi.fn(),
  decryptSecretFile: vi.fn(),
  resolveSyncRule: vi.fn(),
  collectArtifactProfiles: vi.fn(() => new Set(["work"])),
  parseArtifactRelativePath: vi.fn((p) => {
    const segments = p.split("/");
    return {
      profile: segments[0],
      repoPath: segments.slice(1).join("/"),
      secret: p.endsWith(".age"),
    };
  }),
  assertStorageSafeRepoPath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  lstat: mocked.lstat,
  readFile: mocked.readFile,
  readlink: mocked.readlink,
}));

vi.mock("#app/lib/filesystem.ts", () => ({
  getPathStats: mocked.getPathStats,
  listDirectoryEntries: mocked.listDirectoryEntries,
}));

vi.mock("#app/config/sync.ts", () => ({
  resolveSyncRule: mocked.resolveSyncRule,
  resolveManagedSyncMode: vi.fn(() => "normal"),
}));

vi.mock("./repo-artifacts.ts", () => ({
  collectArtifactProfiles: mocked.collectArtifactProfiles,
  parseArtifactRelativePath: mocked.parseArtifactRelativePath,
  assertStorageSafeRepoPath: mocked.assertStorageSafeRepoPath,
}));

vi.mock("#app/lib/file-mode.ts", () => ({
  isExecutableMode: vi.fn(() => false),
}));

describe("repo-snapshot service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds repository snapshot correctly", async () => {
    const config = {
      activeProfile: "work",
      entries: [],
      age: { identityFile: "id.txt" },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValue([{ name: "config.json" }]);
    mocked.lstat.mockResolvedValue({
      isDirectory: () => false,
      isSymbolicLink: () => false,
      isFile: () => true,
      mode: 0o644,
    });
    mocked.readFile.mockResolvedValue(Buffer.from("data"));
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config as any);

    expect(snapshot.size).toBe(1);
    expect(snapshot.get("config.json")).toBeDefined();
    expect(snapshot.get("config.json")?.type).toBe("file");
  });

  it("handles directory entries", async () => {
    const config = {
      activeProfile: "work",
      entries: [{ kind: "directory", repoPath: "dotconfig" }],
      age: { identityFile: "id.txt" },
    };

    mocked.getPathStats.mockResolvedValue({ isDirectory: () => true });
    mocked.listDirectoryEntries.mockResolvedValueOnce([]); // No files found in work/ profile
    mocked.resolveSyncRule.mockReturnValue({ profile: "work", mode: "normal" });

    const snapshot = await buildRepositorySnapshot("/tmp/repo", config as any);

    expect(snapshot.get("dotconfig")?.type).toBe("directory");
  });
});
