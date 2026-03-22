import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { wrapUnknownError } from "./error.js";

const execFileAsync = promisify(execFile);

const runGitCommand = async (
  args: readonly string[],
  options?: Readonly<{ cwd?: string }>,
) => {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd: options?.cwd,
      encoding: "utf8",
      maxBuffer: 10_000_000,
    });

    return {
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } catch (error: unknown) {
    if (error instanceof Error && "stderr" in error) {
      const stderr =
        typeof error.stderr === "string" ? error.stderr.trim() : undefined;
      const stdout =
        "stdout" in error && typeof error.stdout === "string"
          ? error.stdout.trim()
          : undefined;
      const message = stderr || stdout || error.message;

      throw new Error(message);
    }

    throw new Error(error instanceof Error ? error.message : "git failed.");
  }
};

export const ensureRepository = async (directory: string) => {
  await runGitCommand(["-C", directory, "rev-parse", "--is-inside-work-tree"]);
};

export const initializeRepository = async (
  directory: string,
  source?: string,
) => {
  if (source === undefined) {
    await runGitCommand(["init", "-b", "main", directory]);

    return {
      action: "initialized" as const,
    };
  }

  await runGitCommand(["clone", source, directory]);

  return {
    action: "cloned" as const,
    source,
  };
};

export const ensureGitRepository = async (syncDirectory: string) => {
  try {
    await ensureRepository(syncDirectory);
  } catch (error: unknown) {
    throw wrapUnknownError("Sync repository is not initialized.", error, {
      code: "SYNC_REPO_INVALID",
      details: [`Sync directory: ${syncDirectory}`],
      hint: "Run 'devsync init' to create or clone the sync repository.",
    });
  }
};
