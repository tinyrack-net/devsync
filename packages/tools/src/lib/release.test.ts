import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCommit: vi.fn(),
  createTag: vi.fn(),
  getRepoRoot: vi.fn(),
  getWorktreeStatus: vi.fn(),
  hasTag: vi.fn(),
  readPackageVersion: vi.fn(),
  stageFiles: vi.fn(),
  writePackageVersion: vi.fn(),
}));

vi.mock("./git.ts", () => ({
  createCommit: mocks.createCommit,
  createTag: mocks.createTag,
  getRepoRoot: mocks.getRepoRoot,
  getWorktreeStatus: mocks.getWorktreeStatus,
  hasTag: mocks.hasTag,
  stageFiles: mocks.stageFiles,
}));

vi.mock("./package-json.ts", () => ({
  readPackageVersion: mocks.readPackageVersion,
  writePackageVersion: mocks.writePackageVersion,
}));

import { performRelease } from "./release.ts";

describe("performRelease", () => {
  const logger = { info: vi.fn(), start: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRepoRoot.mockResolvedValue("/repo");
    mocks.getWorktreeStatus.mockResolvedValue("");
    mocks.readPackageVersion.mockResolvedValue("1.2.3");
    mocks.hasTag.mockResolvedValue(false);
  });

  describe("happy path", () => {
    test("bumps version, writes, stages, commits, and tags", async () => {
      const result = await performRelease({
        cwd: "/repo",
        dryRun: false,
        logger,
        releaseType: "patch",
      });

      expect(mocks.writePackageVersion).toHaveBeenCalled();
      expect(mocks.stageFiles).toHaveBeenCalledWith("/repo", [
        "packages/cli/package.json",
      ]);
      expect(mocks.createCommit).toHaveBeenCalledWith(
        "/repo",
        "release: v1.2.4",
      );
      expect(mocks.createTag).toHaveBeenCalledWith(
        "/repo",
        "v1.2.4",
        "release: v1.2.4",
        { sign: true },
      );
      expect(result).toEqual({
        dryRun: false,
        previousTag: "v1.2.3",
        tag: "v1.2.4",
        version: "1.2.4",
      });
    });
  });

  describe("signTag option", () => {
    test("defaults signTag to true (signed tag)", async () => {
      await performRelease({
        cwd: "/repo",
        dryRun: false,
        logger,
        releaseType: "patch",
      });

      expect(mocks.createTag).toHaveBeenCalledWith(
        "/repo",
        "v1.2.4",
        "release: v1.2.4",
        { sign: true },
      );
    });

    test("passes signTag:false through as unsigned", async () => {
      await performRelease({
        cwd: "/repo",
        dryRun: false,
        logger,
        releaseType: "patch",
        signTag: false,
      });

      expect(mocks.createTag).toHaveBeenCalledWith(
        "/repo",
        "v1.2.4",
        "release: v1.2.4",
        { sign: false },
      );
    });
  });

  describe("dirty worktree", () => {
    test("throws when worktree dirty and dryRun is false", async () => {
      mocks.getWorktreeStatus.mockResolvedValue("M file.ts");

      await expect(
        performRelease({
          cwd: "/repo",
          dryRun: false,
          logger,
          releaseType: "patch",
        }),
      ).rejects.toThrow(/worktree must be clean/iu);
    });

    test("succeeds with warning when worktree dirty and dryRun is true", async () => {
      mocks.getWorktreeStatus.mockResolvedValue("M file.ts");

      const result = await performRelease({
        cwd: "/repo",
        dryRun: true,
        logger,
        releaseType: "patch",
      });

      expect(result.dryRun).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/dirty/iu),
      );
    });
  });

  describe("missing version", () => {
    test("throws when readPackageVersion rejects", async () => {
      mocks.readPackageVersion.mockRejectedValue(
        new Error("Missing version in /repo/packages/cli/package.json"),
      );

      await expect(
        performRelease({
          cwd: "/repo",
          dryRun: false,
          logger,
          releaseType: "patch",
        }),
      ).rejects.toThrow(/Missing version/u);
    });
  });

  describe("tag collision", () => {
    test("throws when target tag already exists", async () => {
      mocks.hasTag.mockResolvedValue(true);

      await expect(
        performRelease({
          cwd: "/repo",
          dryRun: false,
          logger,
          releaseType: "patch",
        }),
      ).rejects.toThrow(/tag already exists/iu);
    });
  });

  describe("dry-run path", () => {
    test("does not write, stage, commit, or tag", async () => {
      await performRelease({
        cwd: "/repo",
        dryRun: true,
        logger,
        releaseType: "patch",
      });

      expect(mocks.writePackageVersion).not.toHaveBeenCalled();
      expect(mocks.stageFiles).not.toHaveBeenCalled();
      expect(mocks.createCommit).not.toHaveBeenCalled();
      expect(mocks.createTag).not.toHaveBeenCalled();
    });

    test("returns dryRun true with correct version info", async () => {
      const result = await performRelease({
        cwd: "/repo",
        dryRun: true,
        logger,
        releaseType: "minor",
      });

      expect(result).toEqual({
        dryRun: true,
        previousTag: "v1.2.3",
        tag: "v1.3.0",
        version: "1.3.0",
      });
    });

    test("logs dry-run info messages", async () => {
      await performRelease({
        cwd: "/repo",
        dryRun: true,
        logger,
        releaseType: "patch",
      });

      expect(logger.start).toHaveBeenCalledWith(
        expect.stringMatching(/Dry run/iu),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringMatching(/Would update/iu),
      );
    });
  });
});
