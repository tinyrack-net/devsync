import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliPath, ensureCliBuilt } from "../src/test/helpers/cli-entry.js";

const COMPLETE_COMMAND = 'env -u COMP_LINE devsync __complete "${inputs[@]}"';

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
  }>,
) => {
  return execa(process.execPath, [cliPath, ...args], {
    cwd: options?.cwd,
    env: {
      FORCE_COLOR: "0",
      NODE_NO_WARNINGS: "1",
      NO_COLOR: "1",
    },
  });
};

const shellQuote = (value: string) => {
  return `'${value.replaceAll("'", "'\\''")}'`;
};

const runBashCompletion = async (
  words: readonly string[],
  currentWordIndex: number,
  options?: Readonly<{
    cwd?: string;
  }>,
) => {
  const nodePath = shellQuote(process.execPath);
  const cliEntryPath = shellQuote(cliPath);

  return execa(
    "bash",
    [
      "-lc",
      [
        "set -euo pipefail",
        'temp_dir="$(mktemp -d)"',
        `printf '%s\\n' '#!/usr/bin/env bash' "exec ${nodePath} ${cliEntryPath} \\"\\$@\\"" >"$temp_dir/devsync"`,
        'chmod +x "$temp_dir/devsync"',
        "trap 'rm -rf \"$temp_dir\"' EXIT",
        'export PATH="$temp_dir:$PATH"',
        "source <(devsync autocomplete bash)",
        `COMP_WORDS=(${words.map(shellQuote).join(" ")})`,
        `COMP_CWORD=${currentWordIndex}`,
        "__devsync_complete",
        'printf "%s\\n" "${COMPREPLY[@]}"',
      ].join("; "),
    ],
    {
      cwd: options?.cwd,
      env: {
        FORCE_COLOR: "0",
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
      },
    },
  );
};

describe("autocomplete e2e", () => {
  let completionFixtureDirectory: string;

  beforeAll(async () => {
    await ensureCliBuilt();

    completionFixtureDirectory = await mkdtemp(
      join(tmpdir(), "devsync-autocomplete-"),
    );
    await writeFile(join(completionFixtureDirectory, "file-alpha.txt"), "");
    await mkdir(join(completionFixtureDirectory, "folder-beta"));
  });

  afterAll(async () => {
    await rm(completionFixtureDirectory, {
      force: true,
      recursive: true,
    });
  });

  it("appears in root help", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("autocomplete");
    expect(result.stdout).toContain("Print shell autocomplete scripts");
  });

  it("prints a bash autocomplete script for eval", async () => {
    const result = await runCli(["autocomplete", "bash"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("__devsync_complete() {");
    expect(result.stdout).toContain(COMPLETE_COMMAND);
    expect(result.stdout).toContain(
      "complete -o default -o nospace -F __devsync_complete devsync",
    );
    expect(result.stdout).not.toContain("Setup Instructions");
    expect(result.stderr).toBe("");
  });

  it("prints a zsh autocomplete script for eval", async () => {
    const result = await runCli(["autocomplete", "zsh"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("autoload -Uz compinit");
    expect(result.stdout).toContain(COMPLETE_COMMAND);
    expect(result.stdout).toContain("compdef __devsync_complete devsync");
    expect(result.stderr).toBe("");
  });

  it("normalizes __complete input when the command name is included", async () => {
    const result = await runCli(["__complete", "devsync", "aut"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("autocomplete");
    expect(result.stderr).toBe("");
  });

  it("completes track targets and flags after an existing target", async () => {
    const result = await runCli(["__complete", "track", "file-alpha.txt", ""], {
      cwd: completionFixtureDirectory,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual(
      expect.arrayContaining([
        "--mode",
        "--profile",
        "--verbose",
        "file-alpha.txt",
        "folder-beta/",
      ]),
    );
    expect(result.stderr).toBe("");
  });

  it("populates bash completions from the emitted script", async () => {
    const result = await runBashCompletion(["devsync", "aut"], 1);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("autocomplete");
    expect(result.stderr).toBe("");
  });

  it("populates bash path completions for track targets", async () => {
    const result = await runBashCompletion(["devsync", "track", "fi"], 2, {
      cwd: completionFixtureDirectory,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toContain("file-alpha.txt");
    expect(result.stderr).toBe("");
  });

  it("populates bash flag completions after a track target", async () => {
    const result = await runBashCompletion(
      ["devsync", "track", "file-alpha.txt", "-"],
      3,
      {
        cwd: completionFixtureDirectory,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual(
      expect.arrayContaining(["--mode", "--profile", "--verbose"]),
    );
    expect(result.stderr).toBe("");
  });

  it("shows only bash and zsh autocomplete subcommands", async () => {
    const result = await runCli(["autocomplete", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bash");
    expect(result.stdout).toContain("zsh");
    expect(result.stdout).not.toContain("install");
    expect(result.stdout).not.toContain("uninstall");
    expect(result.stderr).toBe("");
  });
});
