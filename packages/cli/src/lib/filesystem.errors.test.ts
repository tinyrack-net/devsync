import { describe, expect, it, vi } from "vitest";
import { getPathStats, pathExists } from "./filesystem.ts";

const mockedFs = vi.hoisted(() => ({
  access: vi.fn(),
  lstat: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: mockedFs.access,
  lstat: mockedFs.lstat,
}));

describe("filesystem helpers - error cases", () => {
  it("handles EACCES error in pathExists", async () => {
    mockedFs.access.mockRejectedValueOnce({ code: "EACCES" });
    await expect(pathExists("/tmp/no-access")).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("handles non-ENOENT error in getPathStats", async () => {
    mockedFs.lstat.mockRejectedValueOnce({ code: "EPERM" });
    await expect(getPathStats("/tmp/perm-denied")).rejects.toMatchObject({
      code: "EPERM",
    });
  });
});
