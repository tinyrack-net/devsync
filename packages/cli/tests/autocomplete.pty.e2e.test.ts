import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { rootCommandNames } from "../src/cli/root-commands.ts";
import { cliNodeOptions } from "../src/test/helpers/cli-entry.ts";
import { createPtySession } from "../src/test/helpers/pty.ts";
import {
  bashPath,
  isBashAvailable,
  zshPath,
} from "../src/test/helpers/shell-availability.ts";

const rootCommandsPattern = new RegExp(rootCommandNames.join("|"), "u");

const shellQuote = (value: string) => {
  return `'${value.replaceAll("'", "'\\''")}'`;
};

const createTestShellDirectory = async (
  rcLines: readonly string[],
  rcFileName: string,
): Promise<{ binDirectory: string; configDirectory: string }> => {
  const configDirectory = await mkdtemp(
    join(tmpdir(), "dotweave-autocomplete-pty-"),
  );
  const binDirectory = join(configDirectory, "bin");

  await mkdir(binDirectory, { recursive: true });

  const cliCommand = [process.execPath, ...cliNodeOptions]
    .map((value) => shellQuote(value))
    .join(" ");

  await writeFile(
    join(binDirectory, "dotweave"),
    ["#!/usr/bin/env bash", `exec ${cliCommand} "$@"`].join("\n"),
  );
  await chmod(join(binDirectory, "dotweave"), 0o755);

  await writeFile(join(configDirectory, rcFileName), rcLines.join("\n"));

  return { binDirectory, configDirectory };
};

describe.skip("autocomplete zsh pty e2e", () => {
  let shellConfigDirectory: string;
  let shellBinDirectory: string;
  let systemPath: string;

  beforeAll(async () => {
    const { PATH: inheritedPath = "" } = process.env;

    systemPath = inheritedPath;

    const { binDirectory, configDirectory } = await createTestShellDirectory(
      [
        "autoload -Uz compinit",
        "zmodload zsh/complist",
        "compinit",
        "zstyle ':completion:*' list-colors ''",
        "zstyle ':completion:*' menu no",
        "PROMPT='PROMPT> '",
        'eval "$(dotweave autocomplete zsh)"',
      ],
      ".zshrc",
    );
    shellBinDirectory = binDirectory;
    shellConfigDirectory = configDirectory;
  });

  afterAll(async () => {
    await rm(shellConfigDirectory, {
      force: true,
      recursive: true,
    });
  });

  const createZshSession = (
    options?: Readonly<{
      binDirectory?: string;
      configDirectory?: string;
    }>,
  ) => {
    return createPtySession({
      args: ["-i"],
      cwd: process.cwd(),
      env: {
        FORCE_COLOR: "0",
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
        PATH: [options?.binDirectory ?? shellBinDirectory, systemPath].join(
          delimiter,
        ),
        ZDOTDIR: options?.configDirectory ?? shellConfigDirectory,
      },
      file: zshPath ?? "zsh",
    });
  };

  it("lists root subcommands in interactive zsh after dotweave tab tab", async () => {
    const session = createZshSession();

    try {
      await session.waitFor("PROMPT> ", 10_000);

      session.write("dotweave\t\t");

      const output = await session.waitFor(rootCommandsPattern, 10_000);

      for (const commandName of rootCommandNames) {
        expect(output).toContain(commandName);
      }
    } finally {
      session.close();
    }
  }, 15_000);

  it("still lists root subcommands after running dotweave once in zsh", async () => {
    const session = createZshSession();

    try {
      await session.waitFor("PROMPT> ", 10_000);

      session.write("dotweave\n");
      await session.waitFor("COMMANDS");
      await session.waitFor(/PROMPT> $/mu);

      session.clearOutput();

      session.write("dotweave\t\t");

      const output = await session.waitFor(rootCommandsPattern, 10_000);

      for (const commandName of rootCommandNames) {
        expect(output).toContain(commandName);
      }
    } finally {
      session.close();
    }
  }, 15_000);
});

describe.skipIf(!isBashAvailable)("autocomplete bash pty e2e", () => {
  let bashBinDirectory: string;
  let bashConfigDirectory: string;
  let systemPath: string;

  beforeAll(async () => {
    const { PATH: inheritedPath = "" } = process.env;

    systemPath = inheritedPath;

    const { binDirectory, configDirectory } = await createTestShellDirectory(
      ['eval "$(dotweave autocomplete bash)"', "PS1='PROMPT> '"],
      ".bashrc",
    );

    bashBinDirectory = binDirectory;
    bashConfigDirectory = configDirectory;
  });

  afterAll(async () => {
    await rm(bashConfigDirectory, {
      force: true,
      recursive: true,
    });
  });

  const createBashSession = () => {
    return createPtySession({
      args: ["--rcfile", join(bashConfigDirectory, ".bashrc"), "-i"],
      cwd: process.cwd(),
      env: {
        FORCE_COLOR: "0",
        NODE_NO_WARNINGS: "1",
        NO_COLOR: "1",
        PATH: [bashBinDirectory, systemPath].join(delimiter),
      },
      file: bashPath ?? "bash",
    });
  };

  it("lists root subcommands in interactive bash", async () => {
    const session = createBashSession();

    try {
      await session.waitFor("PROMPT> ");

      session.write("dotweave \t\t");

      for (const commandName of rootCommandNames) {
        await session.waitFor(commandName, 10_000);
      }

      const output = session.getOutput();

      for (const commandName of rootCommandNames) {
        expect(output).toContain(commandName);
      }
    } finally {
      session.close();
    }
  }, 15_000);

  it("still lists root subcommands after running dotweave once in bash", async () => {
    const session = createBashSession();

    try {
      await session.waitFor("PROMPT> ");

      session.write("dotweave\n");
      await session.waitFor("COMMANDS");
      await session.waitFor(/PROMPT> $/mu);

      session.clearOutput();

      session.write("dotweave \t\t");

      for (const commandName of rootCommandNames) {
        await session.waitFor(commandName, 10_000);
      }

      const output = session.getOutput();

      for (const commandName of rootCommandNames) {
        expect(output).toContain(commandName);
      }
      expect(output).not.toContain("AGENTS.md");
      expect(output).not.toContain("package.json");
    } finally {
      session.close();
    }
  }, 15_000);
});
