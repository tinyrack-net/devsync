import { execa } from "execa";
import { beforeAll, describe, expect, it } from "vitest";
import { cliPath, ensureCliBuilt } from "../src/test/helpers/cli-entry.js";

const runCli = async (args: readonly string[]) => {
  return execa(process.execPath, [cliPath, ...args], {
    env: {
      FORCE_COLOR: "0",
      NODE_NO_WARNINGS: "1",
      NO_COLOR: "1",
    },
  });
};

describe("autocomplete e2e", () => {
  beforeAll(async () => {
    await ensureCliBuilt();
  });

  it("appears in root help", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("autocomplete");
    expect(result.stdout).toContain("Manage shell autocomplete support");
  });

  it("prints bash autocomplete setup instructions", async () => {
    const result = await runCli(["autocomplete", "bash"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Setup Instructions for DEVSYNC CLI Autocomplete",
    );
    expect(result.stdout).toContain("devsync autocomplete install");
    expect(result.stdout).toContain("devsync __complete");
    expect(result.stderr).toBe("");
  });
});
