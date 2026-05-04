import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitCommandOptions = {
  cwd: string;
};

export async function getRepoRoot(cwd: string): Promise<string> {
  return await runGit(["rev-parse", "--show-toplevel"], { cwd });
}

export async function getWorktreeStatus(repoRoot: string): Promise<string> {
  return await runGit(["status", "--porcelain"], { cwd: repoRoot });
}

export async function hasTag(repoRoot: string, tag: string): Promise<boolean> {
  const stdout = await runGit(["tag", "--list", tag], {
    cwd: repoRoot,
  });

  return stdout === tag;
}

export async function stageFiles(
  repoRoot: string,
  filePaths: readonly string[],
): Promise<void> {
  await runGit(["add", ...filePaths], { cwd: repoRoot });
}

export async function createCommit(
  repoRoot: string,
  message: string,
): Promise<void> {
  await runGit(["commit", "-m", message], { cwd: repoRoot });
}

export async function createTag(
  repoRoot: string,
  tag: string,
  message: string,
  options?: {
    sign: boolean;
  },
): Promise<void> {
  const tagMode = options?.sign === false ? "-a" : "-s";

  await runGit(["tag", tagMode, tag, "-m", message], { cwd: repoRoot });
}

async function runGit(
  args: readonly string[],
  options: GitCommandOptions,
): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd: options.cwd,
      encoding: "utf8",
    });

    return result.stdout.trim();
  } catch (error) {
    throw new Error(formatGitError(args, error));
  }
}

function formatGitError(args: readonly string[], error: unknown): string {
  const command = `git ${args.join(" ")}`;

  if (isRecord(error)) {
    const message = readStringProperty(error, "message");
    const stderr = readStringProperty(error, "stderr");

    if (stderr) {
      return `${command} failed: ${stderr.trim()}`;
    }

    if (message) {
      return `${command} failed: ${message}`;
    }
  }

  return `${command} failed`;
}

function readStringProperty(
  value: Record<string, unknown>,
  propertyName: "message" | "stderr",
): string | undefined {
  const propertyValue = value[propertyName];

  return typeof propertyValue === "string" ? propertyValue : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
