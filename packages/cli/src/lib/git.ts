import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { wrapUnknownError } from "#app/lib/error.ts";

const execFileAsync = promisify(execFile);

/**
 * @description
 * Runs a git command and normalizes failures into concise errors.
 */
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

/**
 * @description
 * Runs a git command while collecting output.
 */
const runStreamingGitCommand = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
  }>,
) => {
  return await new Promise<{
    stderr: string;
    stdout: string;
  }>((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      handler();
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish(() => {
        reject(
          new Error(error instanceof Error ? error.message : "git failed."),
        );
      });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(() => {
          resolve({ stderr, stdout });
        });

        return;
      }

      finish(() => {
        reject(
          new Error(
            stderr.trim() ||
              stdout.trim() ||
              `git exited with code ${code ?? "unknown"}.`,
          ),
        );
      });
    });
  });
};

/**
 * @description
 * Verifies that a directory is already a git working tree.
 */
export const ensureRepository = async (directory: string) => {
  await runGitCommand(["-C", directory, "rev-parse", "--is-inside-work-tree"]);
};

/**
 * @description
 * Creates a sync directory locally or clones it from a remote source.
 */
export const initializeRepository = async (
  directory: string,
  source?: string,
) => {
  if (source === undefined) {
    await runStreamingGitCommand(["init", "-b", "main", directory]);

    return {
      action: "initialized" as const,
    };
  }

  await runStreamingGitCommand(["clone", source, directory]);

  return {
    action: "cloned" as const,
    source,
  };
};

/**
 * @description
 * Ensures the sync directory is a usable git repository for dotweave commands.
 */
export const ensureGitRepository = async (syncDirectory: string) => {
  try {
    await ensureRepository(syncDirectory);
  } catch (error: unknown) {
    throw wrapUnknownError("Sync repository is not initialized.", error, {
      code: "SYNC_REPO_INVALID",
      details: [`Sync directory: ${syncDirectory}`],
      hint: "Run 'dotweave init' to create or clone the sync directory.",
    });
  }
};
