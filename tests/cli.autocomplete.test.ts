import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const runCli = async (args: readonly string[]) => {
  return execa(process.execPath, [cliPath, ...args], {
    env: {
      FORCE_COLOR: "0",
      NODE_NO_WARNINGS: "1",
      NO_COLOR: "1",
    },
  });
};

describe("autocomplete command", () => {
  it("appears in root help", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("autocomplete");
    expect(result.stdout).toContain(
      "Display autocomplete installation instructions",
    );
  });

  it("prints bash autocomplete setup instructions", async () => {
    const result = await runCli(["autocomplete", "bash"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Setup Instructions for DEVSYNC CLI Autocomplete",
    );
    expect(result.stdout).toContain("devsync autocomplete script bash");
    expect(result.stderr).toContain("Building the autocomplete cache");
  });
});
