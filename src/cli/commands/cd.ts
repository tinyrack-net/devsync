import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { BaseCommand } from "#app/cli/base-command.ts";
import { resolveDevsyncSyncDirectory } from "#app/config/xdg.ts";
import { output } from "#app/lib/output.ts";

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

export default class SyncCd extends BaseCommand {
  public static override summary =
    "Open a shell in the sync directory or print its path";

  public static override description =
    "Open an interactive shell inside the local sync repository directory for manual inspection and git operations. In non-interactive contexts devsync outputs the directory path instead of spawning a shell.";

  public static override examples = ["<%= config.bin %> <%= command.id %>"];

  public override async run(): Promise<void> {
    const syncDirectory = resolveDevsyncSyncDirectory();

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.print(output(syncDirectory));

      return;
    }

    await spawnShellInDirectory(syncDirectory);
  }
}
