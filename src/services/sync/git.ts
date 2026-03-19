import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitRunner = (
  args: readonly string[],
  options?: Readonly<{
    cwd?: string;
  }>,
) => Promise<{
  stderr: string;
  stdout: string;
}>;

const defaultGitRunner: GitRunner = async (args, options) => {
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

export const createGitService = (gitRunner: GitRunner = defaultGitRunner) => {
  return {
    ensureRepository: async (directory: string) => {
      await gitRunner(["-C", directory, "rev-parse", "--is-inside-work-tree"]);
    },
    initializeRepository: async (directory: string, source?: string) => {
      if (source === undefined) {
        await gitRunner(["init", "-b", "main", directory]);

        return {
          action: "initialized" as const,
        };
      }

      await gitRunner(["clone", source, directory]);

      return {
        action: "cloned" as const,
        source,
      };
    },
  };
};
