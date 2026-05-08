import { beforeEach, describe, expect, test, vi } from "vitest";

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

import {
  createCommit,
  createTag,
  getRepoRoot,
  getWorktreeStatus,
  hasTag,
  stageFiles,
} from "./git.ts";

function mockExecSuccess(stdout: string): void {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      err: NodeJS.ErrnoException | null,
      result: { stderr: string; stdout: string },
    ) => void;
    callback(null, { stdout, stderr: "" });
  });
}

function mockExecFailure(error: unknown): void {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      err: NodeJS.ErrnoException | null,
      result?: { stderr: string; stdout: string },
    ) => void;
    if (typeof error === "object" && error !== null) {
      callback(error as NodeJS.ErrnoException);
    } else {
      callback(new Error(String(error)));
    }
  });
}

describe("git", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRepoRoot", () => {
    test("passes rev-parse --show-toplevel to git", async () => {
      mockExecSuccess("/repo/root\n");
      const result = await getRepoRoot("/some/cwd");

      expect(result).toBe("/repo/root");
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--show-toplevel"],
        expect.objectContaining({ cwd: "/some/cwd" }),
        expect.any(Function),
      );
    });

    test("trims stdout whitespace", async () => {
      mockExecSuccess("  /repo/root  \n  ");
      const result = await getRepoRoot("/some/cwd");

      expect(result).toBe("/repo/root");
    });
  });

  describe("getWorktreeStatus", () => {
    test("passes status --porcelain to git", async () => {
      mockExecSuccess("M file.ts\n");
      const result = await getWorktreeStatus("/repo");

      expect(result).toBe("M file.ts");
      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["status", "--porcelain"],
        expect.objectContaining({ cwd: "/repo" }),
        expect.any(Function),
      );
    });

    test("returns empty string for clean worktree", async () => {
      mockExecSuccess("");
      const result = await getWorktreeStatus("/repo");

      expect(result).toBe("");
    });
  });

  describe("hasTag", () => {
    test("returns true when tag matches exactly", async () => {
      mockExecSuccess("v1.0.0");
      const result = await hasTag("/repo", "v1.0.0");

      expect(result).toBe(true);
    });

    test("returns false when tag list is empty", async () => {
      mockExecSuccess("");
      const result = await hasTag("/repo", "v1.0.0");

      expect(result).toBe(false);
    });

    test("returns false when tag list contains different tag", async () => {
      mockExecSuccess("v1.0.1");
      const result = await hasTag("/repo", "v1.0.0");

      expect(result).toBe(false);
    });
  });

  describe("stageFiles", () => {
    test("passes add with file paths to git", async () => {
      mockExecSuccess("");
      await stageFiles("/repo", ["a.ts", "b.ts"]);

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["add", "a.ts", "b.ts"],
        expect.objectContaining({ cwd: "/repo" }),
        expect.any(Function),
      );
    });
  });

  describe("createCommit", () => {
    test("passes commit -m with message to git", async () => {
      mockExecSuccess("");
      await createCommit("/repo", "release: v1.0.0");

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "release: v1.0.0"],
        expect.objectContaining({ cwd: "/repo" }),
        expect.any(Function),
      );
    });
  });

  describe("createTag", () => {
    test("uses -s (signed) by default when options omitted", async () => {
      mockExecSuccess("");
      await createTag("/repo", "v1.0.0", "release: v1.0.0");

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["tag", "-s", "v1.0.0", "-m", "release: v1.0.0"],
        expect.objectContaining({ cwd: "/repo" }),
        expect.any(Function),
      );
    });

    test("uses -s when sign is true", async () => {
      mockExecSuccess("");
      await createTag("/repo", "v1.0.0", "release: v1.0.0", { sign: true });

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["tag", "-s", "v1.0.0", "-m", "release: v1.0.0"],
        expect.objectContaining({ cwd: "/repo" }),
        expect.any(Function),
      );
    });

    test("uses -a (unsigned) when sign is false", async () => {
      mockExecSuccess("");
      await createTag("/repo", "v1.0.0", "msg", { sign: false });

      expect(mockExecFile).toHaveBeenCalledWith(
        "git",
        ["tag", "-a", "v1.0.0", "-m", "msg"],
        expect.objectContaining({ cwd: "/repo" }),
        expect.any(Function),
      );
    });
  });

  describe("error formatting", () => {
    test("prioritizes stderr over message when both present", async () => {
      mockExecFailure(
        Object.assign(new Error("generic msg"), {
          stderr: "fatal: not a repository",
        }),
      );

      await expect(getRepoRoot("/bad")).rejects.toThrow(
        /git rev-parse.*failed: fatal: not a repository/u,
      );
    });

    test("falls back to message when stderr is empty", async () => {
      mockExecFailure(Object.assign(new Error("some message"), { stderr: "" }));

      await expect(getRepoRoot("/bad")).rejects.toThrow(
        /git rev-parse.*failed: some message/u,
      );
    });

    test("falls back to generic message when neither stderr nor message", async () => {
      mockExecFailure(Object.assign(new Error(""), { stderr: "" }));

      await expect(getRepoRoot("/bad")).rejects.toThrow(
        /git rev-parse.*failed$/u,
      );
    });

    test("handles non-Error thrown value", async () => {
      mockExecFile.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as (err: unknown) => void;
        callback("oops");
      });

      await expect(getRepoRoot("/bad")).rejects.toThrow(
        /git rev-parse.*failed$/u,
      );
    });
  });
});
