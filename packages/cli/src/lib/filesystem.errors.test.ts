import { describe, expect, it, vi } from "vitest";
import {
  getFollowedPathStats,
  getPathStats,
  pathExists,
} from "./filesystem.ts";

const mockedFs = vi.hoisted(() => ({
  access: vi.fn(),
  lstat: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: mockedFs.access,
  lstat: mockedFs.lstat,
  stat: mockedFs.stat,
}));

describe("filesystem helpers - error cases", () => {
  it("handles EACCES error in pathExists", async () => {
    const error = new Error("EACCES") as Error & { code: string };
    error.code = "EACCES";
    mockedFs.access.mockRejectedValueOnce(error);
    await expect(pathExists("/tmp/no-access")).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("handles non-ENOENT error in getPathStats", async () => {
    const error = new Error("EPERM") as Error & { code: string };
    error.code = "EPERM";
    mockedFs.lstat.mockRejectedValueOnce(error);
    await expect(getPathStats("/tmp/perm-denied")).rejects.toMatchObject({
      code: "EPERM",
    });
  });

  it("treats ENOTDIR as absent in getPathStats", async () => {
    const error = new Error("ENOTDIR") as Error & { code: string };
    error.code = "ENOTDIR";
    mockedFs.lstat.mockRejectedValueOnce(error);
    await expect(getPathStats("/tmp/not-dir")).resolves.toBeUndefined();
  });

  it("treats ENOENT as absent in getPathStats", async () => {
    const error = new Error("ENOENT") as Error & { code: string };
    error.code = "ENOENT";
    mockedFs.lstat.mockRejectedValueOnce(error);
    await expect(getPathStats("/tmp/missing")).resolves.toBeUndefined();
  });

  it("re-throws ENOTDIR error in pathExists", async () => {
    const error = new Error("ENOTDIR") as Error & { code: string };
    error.code = "ENOTDIR";
    mockedFs.access.mockRejectedValueOnce(error);
    await expect(pathExists("/tmp/enotdir-path")).rejects.toMatchObject({
      code: "ENOTDIR",
    });
  });

  it("re-throws EISDIR error in pathExists", async () => {
    const error = new Error("EISDIR") as Error & { code: string };
    error.code = "EISDIR";
    mockedFs.access.mockRejectedValueOnce(error);
    await expect(pathExists("/tmp/eisdir-path")).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  it("re-throws EMFILE error in getPathStats", async () => {
    const error = new Error("EMFILE") as Error & { code: string };
    error.code = "EMFILE";
    mockedFs.lstat.mockRejectedValueOnce(error);
    await expect(getPathStats("/tmp/emfile")).rejects.toMatchObject({
      code: "EMFILE",
    });
  });

  it("treats ENOTDIR as absent in getFollowedPathStats", async () => {
    const error = new Error("ENOTDIR") as Error & { code: string };
    error.code = "ENOTDIR";
    mockedFs.stat.mockRejectedValueOnce(error);
    await expect(
      getFollowedPathStats("/tmp/followed-not-dir"),
    ).resolves.toBeUndefined();
  });
});
