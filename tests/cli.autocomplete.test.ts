import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { runCli } from "#app/cli/index.ts";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));

describe("autocomplete command", () => {
  it("appears in root help", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli([], {
      stdout: (text: string) => {
        stdout += text;
      },
      stderr: (text: string) => {
        stderr += text;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("autocomplete");
    expect(stdout).toContain("Display autocomplete installation instructions");
  });

  it("prints bash autocomplete setup instructions", async () => {
    const result = await execa(
      process.execPath,
      [cliPath, "autocomplete", "bash"],
      {
        env: {
          FORCE_COLOR: "0",
          NODE_NO_WARNINGS: "1",
          NO_COLOR: "1",
        },
        reject: false,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Setup Instructions for DEVTOOLS CLI Autocomplete",
    );
    expect(result.stdout).toContain("devtools autocomplete script bash");
    expect(result.stderr).toContain("Building the autocomplete cache");
  });
});
