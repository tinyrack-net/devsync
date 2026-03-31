import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { generateIdentity, identityToRecipient } from "age-encryption";

const execFileAsync = promisify(execFile);

export const gitTestEnvironment = {
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_NAME: "Test User",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test User",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgsign",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

export const createTemporaryDirectory = async (prefix: string) => {
  return await mkdtemp(join(tmpdir(), prefix));
};

export const createAgeKeyPair = async () => {
  const identity = await generateIdentity();

  return {
    identity,
    recipient: await identityToRecipient(identity),
  };
};

export const writeIdentityFile = async (
  xdgConfigHome: string,
  identity: string,
) => {
  const identityFile = join(xdgConfigHome, "devsync", "keys.txt");

  await mkdir(dirname(identityFile), { recursive: true });
  await writeFile(identityFile, `${identity}\n`);

  return identityFile;
};

export const runGit = async (args: readonly string[], cwd?: string) => {
  return await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...gitTestEnvironment },
    maxBuffer: 10_000_000,
  });
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
const ansiPattern = /\x1b\[[0-9;]*m/g;

export const stripAnsi = (value: string) => value.replace(ansiPattern, "");

export const writeJsonFile = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const createShellRecorderEnvironment = async (
  workspace: string,
  markerFile: string,
) => {
  const shellScript = join(workspace, "record-shell.mjs");

  await writeFile(
    shellScript,
    [
      'import { writeFileSync } from "node:fs";',
      "const marker = process.env.DEVSYNC_SHELL_MARKER;",
      'if (!marker) throw new Error("missing marker path");',
      'writeFileSync(marker, process.cwd(), "utf8");',
    ].join("\n"),
    "utf8",
  );

  return {
    DEVSYNC_CD_ARGS: JSON.stringify([shellScript]),
    DEVSYNC_CD_COMMAND: process.execPath,
    DEVSYNC_SHELL_MARKER: markerFile,
  } satisfies NodeJS.ProcessEnv;
};
