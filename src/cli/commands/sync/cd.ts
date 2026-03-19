import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { Command, Flags } from "@oclif/core";

import { resolveDevtoolsSyncDirectory } from "#app/config/xdg.ts";
import { ensureTrailingNewline } from "#app/lib/string.ts";

const readEnvironmentVariable = (name: "ComSpec" | "SHELL") => {
  return process.env[name]?.trim();
};

const resolveCommandShell = () => {
  if (process.platform === "win32") {
    return {
      args: [] as string[],
      command: readEnvironmentVariable("ComSpec") || "cmd.exe",
    };
  }

  return {
    args: ["-i"],
    command: readEnvironmentVariable("SHELL") || "/bin/sh",
  };
};

const spawnShellInDirectory = async (directory: string) => {
  await mkdir(directory, { recursive: true });

  const shell = resolveCommandShell();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(shell.command, shell.args, {
      cwd: directory,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`Shell exited with signal ${signal}.`));

        return;
      }

      if (code === 0) {
        resolve();

        return;
      }

      reject(new Error(`Shell exited with code ${code ?? 1}.`));
    });
  });
};

export default class SyncCd extends Command {
  public static override summary =
    "Open a shell in the sync directory or print its path";

  public static override flags = {
    print: Flags.boolean({
      default: false,
      description: "Print the sync directory path instead of opening a shell",
    }),
  };

  public override async run(): Promise<void> {
    const { flags } = await this.parse(SyncCd);
    const syncDirectory = resolveDevtoolsSyncDirectory();

    if (flags.print || !process.stdin.isTTY || !process.stdout.isTTY) {
      process.stdout.write(ensureTrailingNewline(syncDirectory));

      return;
    }

    await spawnShellInDirectory(syncDirectory);
  }
}
