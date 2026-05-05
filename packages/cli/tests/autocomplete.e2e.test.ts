import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { rootCommandNames } from "../src/cli/root-commands.ts";
import { cliNodeOptions } from "../src/test/helpers/cli-entry.ts";
import {
  isBashAvailable,
  isZshAvailable,
} from "../src/test/helpers/shell-availability.ts";

const COMPLETE_COMMAND = 'env -u COMP_LINE dotweave __complete "${inputs[@]}"';

const runCli = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    env?: Readonly<Record<string, string>>;
  }>,
) => {
  return execa(process.execPath, [...cliNodeOptions, ...args], {
    cwd: options?.cwd,
    env: {
      FORCE_COLOR: "0",
      NODE_NO_WARNINGS: "1",
      NO_COLOR: "1",
      ...options?.env,
    },
  });
};

const completionNames = (stdout: string) =>
  stdout.split("\n").map((line) => line.split("\t")[0] ?? line);

const bashRootCommandNames = rootCommandNames.map((commandName) => {
  return `${commandName} `;
});

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
  const cliCommand = [process.execPath, ...cliNodeOptions]
    .map((value) => shellQuote(value))
    .join(" ");

  const homeDir = await mkdtemp(join(tmpdir(), "dotweave-test-"));

  return execa(
    "bash",
    [
      "-lc",
      [
        "set -euo pipefail",
        'temp_dir="$(mktemp -d)"',
        `printf '%s\\n' '#!/usr/bin/env bash' "exec ${cliCommand} \\"\\$@\\"" >"$temp_dir/dotweave"`,
        'chmod +x "$temp_dir/dotweave"',
        "trap 'rm -rf \"$temp_dir\"' EXIT",
        'export PATH="$temp_dir:$PATH"',
        'eval "$(dotweave autocomplete bash)"',
        `COMP_WORDS=(${words.map(shellQuote).join(" ")})`,
        `COMP_CWORD=${currentWordIndex}`,
        "__dotweave_complete",
        'printf "%s\\n" "${COMPREPLY[@]}"',
      ].join("; "),
    ],
    {
      cwd: options?.cwd,
      env: {
        FORCE_COLOR: "0",
        HOME: homeDir,
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
      },
    },
  );
};

const runZshCompletion = async (
  words: readonly string[],
  currentWord: number,
  options?: Readonly<{
    cwd?: string;
  }>,
) => {
  const cliCommand = [process.execPath, ...cliNodeOptions]
    .map((value) => shellQuote(value))
    .join(" ");

  return execa(
    "zsh",
    [
      "-lc",
      [
        "set -euo pipefail",
        'temp_dir="$(mktemp -d)"',
        `printf '%s\\n' '#!/usr/bin/env bash' "exec ${cliCommand} \\"\\$@\\"" >"$temp_dir/dotweave"`,
        'chmod +x "$temp_dir/dotweave"',
        "trap 'rm -rf \"$temp_dir\"' EXIT",
        'export PATH="$temp_dir:$PATH"',
        "function compdef() { :; }",
        [
          "function compadd() {",
          '  local suffix=""',
          "  while (( $# > 0 )); do",
          '    case "$1" in',
          "      --)",
          "        shift",
          "        break",
          "        ;;",
          "      -Q)",
          "        shift",
          "        ;;",
          "      -S)",
          '        suffix="$2"',
          "        shift 2",
          "        ;;",
          "      *)",
          "        shift",
          "        ;;",
          "    esac",
          "  done",
          '  local completion=""',
          '  for completion in "$@"; do',
          '    printf "%s%s\\n" "$completion" "$suffix"',
          "  done",
          "}",
        ].join("; "),
        'eval "$(dotweave autocomplete zsh)"',
        `words=(${words.map(shellQuote).join(" ")})`,
        `CURRENT=${currentWord}`,
        "__dotweave_complete",
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
    completionFixtureDirectory = await mkdtemp(
      join(tmpdir(), "dotweave-autocomplete-"),
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
    expect(result.stdout).toContain("__dotweave_complete() {");
    expect(result.stdout).toContain(COMPLETE_COMMAND);
    expect(result.stdout).toContain(
      "complete -o default -o nospace -F __dotweave_complete dotweave",
    );
    expect(result.stdout).not.toContain("Setup Instructions");
    expect(result.stderr).toBe("");
  });

  it("prints a zsh autocomplete script for eval", async () => {
    const result = await runCli(["autocomplete", "zsh"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("autoload -Uz compinit");
    expect(result.stdout).toContain(COMPLETE_COMMAND);
    expect(result.stdout).toContain("compdef __dotweave_complete dotweave");
    expect(result.stderr).toBe("");
  });

  it("normalizes __complete input when the command name is included", async () => {
    const result = await runCli(["__complete", "dotweave", "aut"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\t")[0]).toBe("autocomplete");
    expect(result.stderr).toBe("");
  });

  it("completes track targets and flags after an existing target", async () => {
    const result = await runCli(["__complete", "track", "file-alpha.txt", ""], {
      cwd: completionFixtureDirectory,
    });

    expect(result.exitCode).toBe(0);
    expect(completionNames(result.stdout)).toEqual(
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

  it.skipIf(!isBashAvailable)(
    "populates bash completions from the emitted script",
    async () => {
      const result = await runBashCompletion(["dotweave", "aut"], 1);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toContain("autocomplete ");
      expect(result.stderr).toBe("");
    },
  );

  it.skipIf(!isBashAvailable)(
    "offers root subcommands when bash completes the command token itself",
    async () => {
      const result = await runBashCompletion(["dotweave"], 0);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toEqual(
        expect.arrayContaining(bashRootCommandNames),
      );
    },
  );

  it.skipIf(!isBashAvailable)(
    "adds a trailing space for unique bash subcommand completions",
    async () => {
      const result = await runBashCompletion(["dotweave", "pro"], 1);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toContain("profile ");
      expect(result.stderr).toBe("");
    },
  );

  it.skipIf(!isBashAvailable)(
    "populates bash path completions for track targets",
    async () => {
      const result = await runBashCompletion(["dotweave", "track", "fi"], 2, {
        cwd: completionFixtureDirectory,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toContain("file-alpha.txt ");
      expect(result.stderr).toBe("");
    },
  );

  it.skipIf(!isBashAvailable)(
    "populates bash flag completions after a track target",
    async () => {
      const result = await runBashCompletion(
        ["dotweave", "track", "file-alpha.txt", "-"],
        3,
        {
          cwd: completionFixtureDirectory,
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toEqual(
        expect.arrayContaining([
          "--mode ",
          "--profile ",
          "--repo-path ",
          "--verbose ",
        ]),
      );
    },
  );

  it.skipIf(!isZshAvailable)(
    "adds a trailing space for unique zsh subcommand completions",
    async () => {
      const result = await runZshCompletion(["dotweave", "pro"], 2);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toContain("profile");
    },
  );

  it.skipIf(!isZshAvailable)(
    "offers root subcommands when zsh completes the command token itself",
    async () => {
      const result = await runZshCompletion(["dotweave"], 1);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")).toEqual(
        expect.arrayContaining(rootCommandNames),
      );
    },
  );

  it("proposes root subcommands when COMP_LINE has a trailing space", async () => {
    const result = await runCli(["__complete", "dotweave", ""], {
      env: { COMP_LINE: "dotweave " },
    });

    expect(result.exitCode).toBe(0);
    expect(completionNames(result.stdout)).toEqual(
      expect.arrayContaining(rootCommandNames),
    );
    expect(result.stderr).toBe("");
  });

  it("proposes subcommand completions when COMP_LINE targets a command", async () => {
    const result = await runCli(["__complete", "dotweave", "track", ""], {
      env: { COMP_LINE: "dotweave track " },
      cwd: completionFixtureDirectory,
    });

    expect(result.exitCode).toBe(0);
    expect(completionNames(result.stdout)).toEqual(
      expect.arrayContaining([
        "--mode",
        "--profile",
        "--repo-path",
        "--verbose",
      ]),
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
