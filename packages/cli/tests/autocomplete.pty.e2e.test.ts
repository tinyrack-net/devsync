import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rootCommandNames } from "../src/cli/root-commands.js";
import { cliNodeOptions } from "../src/test/helpers/cli-entry.js";
import { createPtySession } from "../src/test/helpers/pty.js";
import {
  isBashAvailable,
  isZshAvailable,
} from "../src/test/helpers/shell-availability.js";

const rootCommandsPattern = new RegExp(rootCommandNames.join("|"), "u");

const shellQuote = (value: string) => {
  return `'${value.replaceAll("'", "'\\''")}'`;
};

const createTestShellDirectory = async (
  rcLines: readonly string[],
  rcFileName: string,
): Promise<{ binDirectory: string; configDirectory: string }> => {
  const configDirectory = await mkdtemp(
    join(tmpdir(), "devsync-autocomplete-pty-"),
  );
  const binDirectory = join(configDirectory, "bin");

  await mkdir(binDirectory, { recursive: true });

  const cliCommand = [process.execPath, ...cliNodeOptions]
    .map((value) => shellQuote(value))
    .join(" ");

  await writeFile(
    join(binDirectory, "devsync"),
    ["#!/usr/bin/env bash", `exec ${cliCommand} "$@"`].join("\n"),
  );
  await chmod(join(binDirectory, "devsync"), 0o755);

  await writeFile(join(configDirectory, rcFileName), rcLines.join("\n"));

  return { binDirectory, configDirectory };
};

describe.skipIf(!isZshAvailable)("autocomplete zsh pty e2e", () => {
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
        'eval "$(devsync autocomplete zsh)"',
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
      file: "zsh",
    });
  };

  it("lists root subcommands in interactive zsh after devsync tab tab", async () => {
    const session = createZshSession();

    try {
      await session.waitFor("PROMPT> ", 10_000);

      session.write("devsync\t\t");

      const output = await session.waitFor(rootCommandsPattern, 10_000);

      for (const commandName of rootCommandNames) {
        expect(output).toContain(commandName);
      }
      expect(output).not.toContain("AGENTS.md");
      expect(output).not.toContain("package.json");
    } finally {
      session.close();
    }
  }, 15_000);

  it("still lists root subcommands after running devsync once in the same shell", async () => {
    const session = createZshSession();

    try {
      await session.waitFor("PROMPT> ", 10_000);

      session.write("devsync\n");
      await session.waitFor("COMMANDS");
      await session.waitFor(/PROMPT> $/mu);

      session.clearOutput();

      session.write("devsync\t\t");

      const output = await session.waitFor(rootCommandsPattern, 10_000);

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

describe.skipIf(!isZshAvailable)(
  "autocomplete zsh pty e2e with compinit on every prompt",
  () => {
    let reinitShellConfigDirectory: string;
    let reinitShellBinDirectory: string;
    let systemPath: string;

    beforeAll(async () => {
      const { PATH: inheritedPath = "" } = process.env;

      systemPath = inheritedPath;

      // Simulate the problematic pattern from use-omz + ez-compinit:
      // A precmd hook calls compinit on every prompt, which resets _comps
      // entries registered via compdef. The reinit hook is registered
      // BEFORE the autocomplete eval, matching the real-world loading
      // order where plugin managers add hooks before user completions.
      const { binDirectory, configDirectory } = await createTestShellDirectory(
        [
          "autoload -Uz compinit add-zsh-hook",
          "compinit",
          "zstyle ':completion:*' menu no",
          "__test_reinit_compinit() { compinit; }",
          "add-zsh-hook precmd __test_reinit_compinit",
          'eval "$(devsync autocomplete zsh)"',
          "PROMPT='PROMPT> '",
        ],
        ".zshrc",
      );
      reinitShellBinDirectory = binDirectory;
      reinitShellConfigDirectory = configDirectory;
    });

    afterAll(async () => {
      await rm(reinitShellConfigDirectory, {
        force: true,
        recursive: true,
      });
    });

    it("lists root subcommands even when compinit runs on every prompt", async () => {
      const session = createPtySession({
        args: ["-i"],
        cwd: process.cwd(),
        env: {
          FORCE_COLOR: "0",
          NODE_NO_WARNINGS: "1",
          NO_COLOR: "1",
          PATH: [reinitShellBinDirectory, systemPath].join(delimiter),
          ZDOTDIR: reinitShellConfigDirectory,
        },
        file: "zsh",
      });

      try {
        await session.waitFor("PROMPT> ", 10_000);

        session.write("devsync\n");
        await session.waitFor("COMMANDS");
        await session.waitFor(/PROMPT> $/mu);

        session.clearOutput();

        session.write("devsync\t\t");

        const output = await session.waitFor(rootCommandsPattern, 10_000);

        for (const commandName of rootCommandNames) {
          expect(output).toContain(commandName);
        }
        expect(output).not.toContain("AGENTS.md");
        expect(output).not.toContain("package.json");
      } finally {
        session.close();
      }
    }, 15_000);
  },
);

describe.skipIf(!isBashAvailable)("autocomplete bash pty e2e", () => {
  let bashBinDirectory: string;
  let bashConfigDirectory: string;
  let systemPath: string;

  beforeAll(async () => {
    const { PATH: inheritedPath = "" } = process.env;

    systemPath = inheritedPath;

    const { binDirectory, configDirectory } = await createTestShellDirectory(
      ['eval "$(devsync autocomplete bash)"', "PS1='PROMPT> '"],
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
      file: "bash",
    });
  };

  it("lists root subcommands in interactive bash", async () => {
    const session = createBashSession();

    try {
      await session.waitFor("PROMPT> ");

      session.write("devsync \t\t");

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

  it("still lists root subcommands after running devsync once in bash", async () => {
    const session = createBashSession();

    try {
      await session.waitFor("PROMPT> ");

      session.write("devsync\n");
      await session.waitFor("COMMANDS");
      await session.waitFor(/PROMPT> $/mu);

      session.clearOutput();

      session.write("devsync \t\t");

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
