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
    const [
      addHelp,
      cdHelp,
      doctorHelp,
      forgetHelp,
      initHelp,
      listHelp,
      pullHelp,
      pushHelp,
      setHelp,
      statusHelp,
    ] = await Promise.all([
      runCli(["add", "--help"]),
      runCli(["cd", "--help"]),
      runCli(["doctor", "--help"]),
      runCli(["forget", "--help"]),
      runCli(["init", "--help"]),
      runCli(["list", "--help"]),
      runCli(["pull", "--help"]),
      runCli(["push", "--help"]),
      runCli(["set", "--help"]),
      runCli(["status", "--help"]),
    ]);

    expect(addHelp.stdout).toContain("$ devsync add TARGET");
    expect(addHelp.stdout).toContain("EXAMPLES");
    expect(addHelp.stdout).toContain("$ devsync add ~/.gitconfig");
    expect(addHelp.stdout).toContain("FLAG DESCRIPTIONS");
    expect(addHelp.stdout).toContain(
      "Mark the added file or directory as secret immediately",
    );

    expect(cdHelp.stdout).toContain("$ devsync cd");
    expect(cdHelp.stdout).toContain("$ devsync cd --print");
    expect(cdHelp.stdout).toContain(
      "Write the sync directory path to stdout and exit",
    );

    expect(doctorHelp.stdout).toContain("$ devsync doctor");
    expect(doctorHelp.stdout).toContain(
      "Run health checks for the local sync setup",
    );

    expect(forgetHelp.stdout).toContain("$ devsync forget TARGET");
    expect(forgetHelp.stdout).toContain("$ devsync forget ~/.gitconfig");

    expect(initHelp.stdout).toContain("$ devsync init [REPOSITORY]");
    expect(initHelp.stdout).toContain(
      "$ devsync init https://example.com/my-sync-repo.git",
    );
    expect(initHelp.stdout).toContain(
      '--identity "$XDG_CONFIG_HOME/devsync/age/keys.txt" --recipient age1...',
    );
    expect(initHelp.stdout).toContain("FLAG DESCRIPTIONS");
    expect(initHelp.stdout).toContain("Repeat this flag to encrypt");

    expect(listHelp.stdout).toContain("$ devsync list");
    expect(listHelp.stdout).toContain(
      "Print the current devsync configuration",
    );

    expect(pullHelp.stdout).toContain("$ devsync pull");
    expect(pullHelp.stdout).toContain("$ devsync pull --dry-run");
    expect(pullHelp.stdout).toContain(
      "Show which local files and directories devsync would create",
    );

    expect(pushHelp.stdout).toContain("$ devsync push");
    expect(pushHelp.stdout).toContain("$ devsync push --dry-run");
    expect(pushHelp.stdout).toContain(
      "Show which repository files devsync would create",
    );

    expect(setHelp.stdout).toContain("$ devsync set STATE TARGET");
    expect(setHelp.stdout).toContain(
      "$ devsync set ignore ~/.config/mytool/cache --recursive",
    );
    expect(setHelp.stdout).toContain("FLAG DESCRIPTIONS");
    expect(setHelp.stdout).toContain(
      "When the target is a directory, update the whole subtree",
    );

    expect(statusHelp.stdout).toContain("$ devsync status");
    expect(statusHelp.stdout).toContain(
      "Compare the tracked local files with the sync",
    );
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
