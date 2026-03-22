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
    expect(result.stdout).toContain("add");
    expect(result.stdout).toContain("remove");
    expect(result.stdout).toContain("set");
    expect(result.stdout).toContain("assign");
    expect(result.stdout).toContain("unassign");
    expect(result.stdout).toContain("machine");
    expect(result.stdout).toContain("push");
    expect(result.stdout).toContain("pull");
    expect(result.stdout).toContain("status");
  });

  it("shows help for add, set, assign, and machine commands", async () => {
    const [addHelp, setHelp, assignHelp, machineHelp] = await Promise.all([
      runCli(["add", "--help"]),
      runCli(["set", "--help"]),
      runCli(["assign", "--help"]),
      runCli(["machine", "use", "--help"]),
    ]);

    expect(addHelp.stdout).toContain("$ devsync add TARGET");
    expect(addHelp.stdout).toContain("--secret");

    expect(setHelp.stdout).toContain("$ devsync set TARGET STATE");
    expect(setHelp.stdout).toContain("--recursive");

    expect(assignHelp.stdout).toContain("$ devsync assign TARGET");
    expect(assignHelp.stdout).toContain("--machine");

    expect(machineHelp.stdout).toContain("$ devsync machine use MACHINE");
  });

  it("returns a non-zero exit code for removed command surfaces", async () => {
    const [trackResult, untrackResult, entryResult, ruleResult] =
      await Promise.all([
        runCli(["track", "~/.gitconfig"], { reject: false }),
        runCli(["untrack", "~/.gitconfig"], { reject: false }),
        runCli(["entry", "mode", "secret", "~/.gitconfig"], { reject: false }),
        runCli(["rule", "set", "secret", "~/.gitconfig"], { reject: false }),
      ]);

    expect(trackResult.exitCode).not.toBe(0);
    expect(trackResult.stderr).toContain("not found");
    expect(untrackResult.exitCode).not.toBe(0);
    expect(untrackResult.stderr).toContain("not found");
    expect(entryResult.exitCode).not.toBe(0);
    expect(entryResult.stderr).toContain("not found");
    expect(ruleResult.exitCode).not.toBe(0);
    expect(ruleResult.stderr).toContain("not found");
  });
});
