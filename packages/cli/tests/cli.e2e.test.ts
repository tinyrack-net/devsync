import { describe, expect, it } from "bun:test";
import { execa } from "execa";
import packageJson from "../package.json" with { type: "json" };
import { rootCommandNames } from "../src/cli/root-commands.ts";
import { cliNodeOptions } from "../src/test/helpers/cli-entry.ts";

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    env?: NodeJS.ProcessEnv;
    reject?: boolean;
  }>,
) => {
  return execa(process.execPath, [...cliNodeOptions, ...args], {
    env: options?.env,
    reject: options?.reject,
  });
};

describe("CLI e2e", () => {
  it("shows the version from the real entrypoint", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`dotweave/${packageJson.version}`);
    expect(result.stderr).toBe("");
  });

  it("shows root help with the new command surface", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    for (const commandName of rootCommandNames) {
      expect(result.stdout).toContain(commandName);
    }

    expect(result.stdout).toContain("Launch a shell in the sync directory");
  });

  it("shows help for cd, track, and profile use commands", async () => {
    const [cdHelp, trackHelp, profileHelp] = await Promise.all([
      runCli(["cd", "--help"]),
      runCli(["track", "--help"]),
      runCli(["profile", "use", "--help"]),
    ]);

    expect(cdHelp.stdout).toContain("USAGE");
    expect(cdHelp.stdout).toContain("Launch a child shell rooted");

    expect(trackHelp.stdout).toContain("USAGE");
    expect(trackHelp.stdout).toContain("--mode");
    expect(trackHelp.stdout).toContain("--profile");
    expect(trackHelp.stdout).toContain("--repo-path");

    expect(profileHelp.stdout).toContain("Profile name to activate");
  });

  it("returns a non-zero exit code for removed command surfaces", async () => {
    const [addResult, removeResult, modeResult, listResult, dirResult] =
      await Promise.all([
        runCli(["add", "~/.gitconfig"], { reject: false }),
        runCli(["remove", "~/.gitconfig"], { reject: false }),
        runCli(["mode", "secret", "~/.gitconfig"], { reject: false }),
        runCli(["list"], { reject: false }),
        runCli(["dir"], { reject: false }),
      ]);

    expect(addResult.exitCode).not.toBe(0);
    expect(addResult.stderr).toContain("not found");
    expect(removeResult.exitCode).not.toBe(0);
    expect(removeResult.stderr).toContain("not found");
    expect(modeResult.exitCode).not.toBe(0);
    expect(modeResult.stderr).toContain("not found");
    expect(listResult.exitCode).not.toBe(0);
    expect(listResult.stderr).toContain("not found");
    expect(dirResult.exitCode).not.toBe(0);
    expect(dirResult.stderr).toContain("not found");
  });
});
