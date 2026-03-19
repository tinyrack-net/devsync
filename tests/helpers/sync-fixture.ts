import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { generateIdentity, identityToRecipient } from "age-encryption";

const execFileAsync = promisify(execFile);

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
  const identityFile = join(xdgConfigHome, "devsync", "age", "keys.txt");

  await mkdir(dirname(identityFile), { recursive: true });
  await writeFile(identityFile, `${identity}\n`);

  return identityFile;
};

export const runGit = async (args: readonly string[], cwd?: string) => {
  return await execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10_000_000,
  });
};

export const writeJsonFile = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
