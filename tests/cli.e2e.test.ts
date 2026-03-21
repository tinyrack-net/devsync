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
    expect(result.stdout).toContain("entry");
    expect(result.stdout).toContain("machine");
    expect(result.stdout).toContain("rule");
    expect(result.stdout).toContain("push");
    expect(result.stdout).toContain("pull");
    expect(result.stdout).toContain("status");
  });

  it("shows help for track, entry, rule, and machine commands", async () => {
    const [trackHelp, entryHelp, ruleHelp, machineHelp] = await Promise.all([
      runCli(["track", "--help"]),
      runCli(["entry", "mode", "--help"]),
      runCli(["rule", "set", "--help"]),
      runCli(["machine", "use", "--help"]),
    ]);

    expect(trackHelp.stdout).toContain("$ devsync track TARGET");
    expect(trackHelp.stdout).toContain("--mode");

    expect(entryHelp.stdout).toContain("$ devsync entry mode STATE TARGET");

    expect(ruleHelp.stdout).toContain("$ devsync rule set STATE TARGET");
    expect(ruleHelp.stdout).toContain("--recursive");

    expect(machineHelp.stdout).toContain("$ devsync machine use MACHINE");
  });

  it("returns a non-zero exit code for removed command surfaces", async () => {
    const [addResult, forgetResult, setResult] = await Promise.all([
      runCli(["add", "~/.gitconfig"], { reject: false }),
      runCli(["forget", "~/.gitconfig"], { reject: false }),
      runCli(["set", "secret", "~/.gitconfig"], { reject: false }),
    ]);

    expect(addResult.exitCode).not.toBe(0);
    expect(addResult.stderr).toContain("not found");
    expect(forgetResult.exitCode).not.toBe(0);
    expect(forgetResult.stderr).toContain("not found");
    expect(setResult.exitCode).not.toBe(0);
    expect(setResult.stderr).toContain("not found");
  });
});
