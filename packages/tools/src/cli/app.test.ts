import { beforeEach, describe, expect, mock, test } from "bun:test";

type MockFn = ReturnType<typeof mock>;

mock.module("../lib/release.ts", () => ({
  performRelease: mock(),
  releaseTypeSchema: {
    options: ["patch", "minor", "major"],
    safeParseAsync: async (input: string) => ({
      success: ["patch", "minor", "major"].includes(input),
      data: input,
    }),
  },
}));

import * as mockedRelease from "../lib/release.ts";

describe("tools cli", () => {
  beforeEach(() => {
    (mockedRelease.performRelease as MockFn).mockReset();
    (mockedRelease.performRelease as MockFn).mockResolvedValue({
      dryRun: true,
      previousTag: "v0.0.3",
      tag: "v0.1.0",
      version: "0.1.0",
    });
  });

  test("passes --dry-run to the release command", async () => {
    const { runCli } = await import("./app.ts");

    await runCli(["release", "minor", "--dry-run"], {
      process: {
        env: process.env,
        exitCode: null,
        stdout: process.stdout,
        stderr: process.stderr,
      },
    });

    expect(mockedRelease.performRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        dryRun: true,
        releaseType: "minor",
      }),
    );
  });
});
