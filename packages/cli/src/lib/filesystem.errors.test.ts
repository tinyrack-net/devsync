import { describe, expect, it, mock } from "bun:test";
import { getPathStats, pathExists } from "./filesystem.ts";

type MockFn = ReturnType<typeof mock>;

mock.module("node:fs/promises", () => ({
  access: mock(),
  lstat: mock(),
}));

import * as mockedFs from "node:fs/promises";

const mockedFsAccess = mockedFs.access as MockFn;
const mockedFsLstat = mockedFs.lstat as MockFn;

describe("filesystem helpers - error cases", () => {
  it("handles EACCES error in pathExists", async () => {
    mockedFsAccess.mockRejectedValueOnce({ code: "EACCES" });
    await expect(pathExists("/tmp/no-access")).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("handles non-ENOENT error in getPathStats", async () => {
    mockedFsLstat.mockRejectedValueOnce({ code: "EPERM" });
    await expect(getPathStats("/tmp/perm-denied")).rejects.toMatchObject({
      code: "EPERM",
    });
  });
});
