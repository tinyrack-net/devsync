import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { buildExecutableMode, isExecutableMode } from "#app/lib/file-mode.js";

import { DevsyncError } from "./error.js";

export const pathExists = async (path: string) => {
  try {
    await access(path);

    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

export const getPathStats = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

export const listDirectoryEntries = async (path: string) => {
  const entries = await readdir(path, { withFileTypes: true });

  return entries.sort((left, right) => {
    return left.name.localeCompare(right.name);
  });
};

export const writeFileNode = async (
  path: string,
  node: Readonly<{
    contents: string | Uint8Array;
    executable: boolean;
  }>,
) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, node.contents);
  await chmod(path, buildExecutableMode(node.executable));
};

export const writeSymlinkNode = async (path: string, linkTarget: string) => {
  await mkdir(dirname(path), { recursive: true });
  await rm(path, { force: true, recursive: true });
  await symlink(linkTarget, path);
};

export const copyFilesystemNode = async (
  sourcePath: string,
  targetPath: string,
  stats?: Awaited<ReturnType<typeof lstat>>,
) => {
  const sourceStats = stats ?? (await lstat(sourcePath));

  if (sourceStats.isDirectory()) {
    await mkdir(targetPath, { recursive: true });

    const entries = await listDirectoryEntries(sourcePath);

    for (const entry of entries) {
      await copyFilesystemNode(
        join(sourcePath, entry.name),
        join(targetPath, entry.name),
      );
    }

    return;
  }

  if (sourceStats.isSymbolicLink()) {
    await writeSymlinkNode(targetPath, await readlink(sourcePath));

    return;
  }

  if (!sourceStats.isFile()) {
    throw new DevsyncError(`Unsupported filesystem entry: ${sourcePath}`);
  }

  await writeFileNode(targetPath, {
    contents: await readFile(sourcePath),
    executable: isExecutableMode(sourceStats.mode),
  });
};

export const replacePathAtomically = async (
  targetPath: string,
  nextPath: string,
) => {
  const backupPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.devsync-sync-backup-${randomUUID()}`,
  );
  const existingStats = await getPathStats(targetPath);
  let targetMoved = false;

  try {
    if (existingStats !== undefined) {
      await rename(targetPath, backupPath);
      targetMoved = true;
    }

    await rename(nextPath, targetPath);

    if (targetMoved) {
      await rm(backupPath, { force: true, recursive: true });
    }
  } catch (error: unknown) {
    if (targetMoved && !(await pathExists(targetPath))) {
      await rename(backupPath, targetPath).catch(() => {});
    }

    throw error;
  } finally {
    await rm(backupPath, { force: true, recursive: true }).catch(() => {});
  }
};

export const removePathAtomically = async (targetPath: string) => {
  const stats = await getPathStats(targetPath);

  if (stats === undefined) {
    return;
  }

  const backupPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.devsync-sync-remove-${randomUUID()}`,
  );

  await rename(targetPath, backupPath);
  await rm(backupPath, { force: true, recursive: true });
};

export const writeTextFileAtomically = async (
  targetPath: string,
  contents: string,
) => {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(dirname(targetPath), `.${basename(targetPath)}.devsync-sync-`),
  );
  const stagedPath = join(stagingDirectory, basename(targetPath));

  try {
    await writeFile(stagedPath, contents, "utf8");
    await replacePathAtomically(targetPath, stagedPath);
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true });
  }
};
