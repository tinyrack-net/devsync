import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const cliPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    env?: NodeJS.ProcessEnv;
    reject?: boolean;
  }>,
) => {
  return execa(process.execPath, [cliPath, ...args], {
    env: options?.env,
    reject: options?.reject,
  });
};

describe("CLI e2e", () => {
  it("shows the version from the real entrypoint", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`devsync/${packageJson.version}`);
    expect(result.stderr).toBe("");
  });

  it("shows root help with the new command surface", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("autocomplete");
    expect(result.stdout).toContain("track");
    expect(result.stdout).toContain("untrack");
    expect(result.stdout).toContain("mode");
    expect(result.stdout).toContain("machine");
    expect(result.stdout).toContain("push");
    expect(result.stdout).toContain("pull");
    expect(result.stdout).toContain("status");
  });

  it("shows help for track, mode, machine assign, and machine use commands", async () => {
    const [trackHelp, modeHelp, machineAssignHelp, machineHelp] =
      await Promise.all([
        runCli(["track", "--help"]),
        runCli(["mode", "--help"]),
        runCli(["machine", "assign", "--help"]),
        runCli(["machine", "use", "--help"]),
      ]);

    expect(trackHelp.stdout).toContain("$ devsync track");
    expect(trackHelp.stdout).toContain("--mode");

    expect(modeHelp.stdout).toContain("$ devsync mode TARGET MODE");
    expect(modeHelp.stdout).toContain("--recursive");

    expect(machineAssignHelp.stdout).toContain("$ devsync machine assign");

    expect(machineHelp.stdout).toContain("$ devsync machine use MACHINE");
  });

  it("returns a non-zero exit code for removed command surfaces", async () => {
    const [addResult, removeResult, entryResult, ruleResult] =
      await Promise.all([
        runCli(["add", "~/.gitconfig"], { reject: false }),
        runCli(["remove", "~/.gitconfig"], { reject: false }),
        runCli(["entry", "mode", "secret", "~/.gitconfig"], {
          reject: false,
        }),
        runCli(["rule", "set", "secret", "~/.gitconfig"], {
          reject: false,
        }),
      ]);

    expect(addResult.exitCode).not.toBe(0);
    expect(addResult.stderr).toContain("not found");
    expect(removeResult.exitCode).not.toBe(0);
    expect(removeResult.stderr).toContain("not found");
    expect(entryResult.exitCode).not.toBe(0);
    expect(entryResult.stderr).toContain("not found");
    expect(ruleResult.exitCode).not.toBe(0);
    expect(ruleResult.stderr).toContain("not found");
  });
});
