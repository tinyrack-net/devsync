import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

  test("generates a version manifest with the matching winget schema", async () => {
    const artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), "dotweave-"));
    await fs.writeFile(path.join(artifactsDir, "dotweave-win-x64.exe"), "x64");
    await fs.writeFile(
      path.join(artifactsDir, "dotweave-win-arm64.exe"),
      "arm64",
    );

    const { runCli } = await import("./app.ts");

    await runCli(
      [
        "winget",
        "generate",
        "--version",
        "v0.42.9",
        "--artifacts-dir",
        artifactsDir,
      ],
      {
        process: {
          env: process.env,
          exitCode: null,
          stdout: process.stdout,
          stderr: process.stderr,
        },
      },
    );

    const versionManifest = await fs.readFile(
      path.join(artifactsDir, "winget-0.42.9", "tinyrack.dotweave.yaml"),
      "utf8",
    );

    expect(versionManifest).toContain(
      "$schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json",
    );
    expect(versionManifest).toContain("ManifestType: version");
  });
});
