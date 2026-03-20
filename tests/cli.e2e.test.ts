import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

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
    expect(result.stdout).toContain("devsync/1.0.0");
    expect(result.stderr).toBe("");
  });

  it("shows root help with flat sync commands and autocomplete", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("autocomplete");
    expect(result.stdout).toContain("add");
    expect(result.stdout).toContain("cd");
    expect(result.stdout).toContain("forget");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("pull");
    expect(result.stdout).toContain("push");
    expect(result.stdout).toContain("set");
    expect(result.stdout).not.toContain("install skills");
    expect(result.stdout).not.toContain("uninstall skills");
    expect(result.stdout).not.toContain("web search");
  });

  it("shows help for flat sync commands", async () => {
    const [addHelp, cdHelp, forgetHelp, initHelp, pullHelp, pushHelp, setHelp] =
      await Promise.all([
        runCli(["add", "--help"]),
        runCli(["cd", "--help"]),
        runCli(["forget", "--help"]),
        runCli(["init", "--help"]),
        runCli(["pull", "--help"]),
        runCli(["push", "--help"]),
        runCli(["set", "--help"]),
      ]);

    expect(addHelp.stdout).toContain("$ devsync add TARGET");
    expect(cdHelp.stdout).toContain("$ devsync cd");
    expect(forgetHelp.stdout).toContain("$ devsync forget TARGET");
    expect(initHelp.stdout).toContain("$ devsync init [REPOSITORY]");
    expect(pullHelp.stdout).toContain("$ devsync pull");
    expect(pushHelp.stdout).toContain("$ devsync push");
    expect(setHelp.stdout).toContain("$ devsync set STATE TARGET");
  });

  it("returns a non-zero exit code for removed command surfaces", async () => {
    const [syncResult, webResult, installResult] = await Promise.all([
      runCli(["sync", "init"], { reject: false }),
      runCli(["web", "search", "query"], { reject: false }),
      runCli(["install", "skills", "pi"], { reject: false }),
    ]);

    expect(syncResult.exitCode).not.toBe(0);
    expect(syncResult.stderr).toContain("not found");
    expect(webResult.exitCode).not.toBe(0);
    expect(webResult.stderr).toContain("not found");
    expect(installResult.exitCode).not.toBe(0);
    expect(installResult.stderr).toContain("not found");
  });
});
