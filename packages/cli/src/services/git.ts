import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import type { ProgressReporter } from "#app/lib/progress.js";

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

const forwardGitProgressChunk = (
  reporter: ProgressReporter | undefined,
  state: { remainder: string },
  chunk: string,
) => {
  if (!reporter?.verbose) {
    return;
  }

  state.remainder += chunk.replaceAll("\r", "\n");
  const lines = state.remainder.split("\n");

  state.remainder = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      reporter.detail(`git: ${trimmed}`);
    }
  }
};

const flushGitProgressChunk = (
  reporter: ProgressReporter | undefined,
  state: { remainder: string },
) => {
  if (!reporter?.verbose) {
    return;
  }

  const trimmed = state.remainder.trim();

  if (trimmed.length > 0) {
    reporter.detail(`git: ${trimmed}`);
  }
};

const runStreamingGitCommand = async (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
    reporter?: ProgressReporter;
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
    const stdoutState = { remainder: "" };
    const stderrState = { remainder: "" };

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
      forwardGitProgressChunk(options?.reporter, stdoutState, chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      forwardGitProgressChunk(options?.reporter, stderrState, chunk);
    });
    child.on("error", (error) => {
      finish(() => {
        reject(
          new Error(error instanceof Error ? error.message : "git failed."),
        );
      });
    });
    child.on("close", (code) => {
      flushGitProgressChunk(options?.reporter, stdoutState);
      flushGitProgressChunk(options?.reporter, stderrState);

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

export const ensureRepository = async (directory: string) => {
  await runGitCommand(["-C", directory, "rev-parse", "--is-inside-work-tree"]);
};

export const initializeRepository = async (
  directory: string,
  source?: string,
  reporter?: ProgressReporter,
) => {
  if (source === undefined) {
    await runStreamingGitCommand(["init", "-b", "main", directory], {
      reporter,
    });

    return {
      action: "initialized" as const,
    };
  }

  await runStreamingGitCommand(["clone", source, directory], {
    reporter,
  });

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
