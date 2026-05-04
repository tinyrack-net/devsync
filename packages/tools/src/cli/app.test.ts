import { beforeEach, describe, expect, test, vi } from "vitest";

const performRelease = vi.fn();

vi.mock("../lib/release.ts", () => ({
  performRelease,
  releaseTypeSchema: {
    options: ["patch", "minor", "major"],
    safeParseAsync: async (input: string) => ({
      success: ["patch", "minor", "major"].includes(input),
      data: input,
    }),
  },
}));

describe("tools cli", () => {
  beforeEach(() => {
    performRelease.mockReset();
    performRelease.mockResolvedValue({
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

    expect(performRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        dryRun: true,
        releaseType: "minor",
      }),
    );
  });
});
