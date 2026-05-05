import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { isExecutableMode } from "#app/lib/file-mode.ts";
import { createTemporaryDirectory } from "../test/helpers/sync-fixture.ts";
import {
  copyFilesystemNode,
  createSymlink,
  getPathStats,
  listDirectoryEntries,
  pathExists,
  removePathAtomically,
  replacePathAtomically,
  writeFileNode,
  writeSymlinkNode,
  writeTextFileAtomically,
} from "./filesystem.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-filesystem-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("filesystem helpers", () => {
  it("checks path existence and missing stats", async () => {
    const workspace = await createWorkspace();
    const filePath = join(workspace, "value.txt");

    expect(await pathExists(filePath)).toBe(false);
    expect(await getPathStats(filePath)).toBeUndefined();

    await writeFile(filePath, "value\n", "utf8");

    expect(await pathExists(filePath)).toBe(true);
    expect((await getPathStats(filePath))?.isFile()).toBe(true);
  });

  it("lists directory entries in sorted order", async () => {
    const workspace = await createWorkspace();

    await mkdir(join(workspace, "b"), { recursive: true });
    await writeFile(join(workspace, "c.txt"), "c\n", "utf8");
    await writeFile(join(workspace, "a.txt"), "a\n", "utf8");

    const entries = await listDirectoryEntries(workspace);

    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "b", "c.txt"]);
  });

  it("writes regular files and preserves executable bits", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const filePath = join(workspace, "bin", "tool.sh");

    await writeFileNode(filePath, {
      contents: "#!/bin/sh\nexit 0\n",
      executable: true,
    });

    expect(await readFile(filePath, "utf8")).toContain("#!/bin/sh");
    expect(isExecutableMode((await lstat(filePath)).mode)).toBe(true);
  });

  it("writes symlinks after removing existing content", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const linkPath = join(workspace, "links", "current");

    await mkdir(join(workspace, "links"), { recursive: true });
    await writeFile(linkPath, "old\n", "utf8");
    await writeSymlinkNode(linkPath, "../target.txt");

    expect(await readlink(linkPath)).toBe("../target.txt");
  });

  it("copies regular files and symlinks", async () => {
    const workspace = await createWorkspace();
    const sourceDirectory = join(workspace, "source");
    const targetDirectory = join(workspace, "target");
    const filePath = join(sourceDirectory, "nested", "value.txt");
    const linkPath = join(sourceDirectory, "nested", "value-link");

    await mkdir(join(sourceDirectory, "nested"), { recursive: true });
    await writeFile(filePath, "payload\n", "utf8");
    await chmod(filePath, 0o755);
    await createSymlink("value.txt", linkPath);

    await copyFilesystemNode(sourceDirectory, targetDirectory);

    expect(
      await readFile(join(targetDirectory, "nested", "value.txt"), "utf8"),
    ).toBe("payload\n");
    expect(await readlink(join(targetDirectory, "nested", "value-link"))).toBe(
      "value.txt",
    );
  });

  it("replaces and removes paths atomically", async () => {
    const workspace = await createWorkspace();
    const targetPath = join(workspace, "config.json");
    const stagedPath = join(workspace, "next.json");

    await writeFile(targetPath, "old\n", "utf8");
    await writeFile(stagedPath, "new\n", "utf8");

    await replacePathAtomically(targetPath, stagedPath);

    expect(await readFile(targetPath, "utf8")).toBe("new\n");
    expect(await pathExists(stagedPath)).toBe(false);

    await removePathAtomically(targetPath);

    expect(await pathExists(targetPath)).toBe(false);
    await removePathAtomically(targetPath);
    expect(await pathExists(targetPath)).toBe(false);
  });

  it("writes text files atomically for create and overwrite flows", async () => {
    const workspace = await createWorkspace();
    const targetPath = join(workspace, "nested", "config.json");

    await writeTextFileAtomically(targetPath, "first\n");
    expect(await readFile(targetPath, "utf8")).toBe("first\n");

    await writeTextFileAtomically(targetPath, "second\n");
    expect(await readFile(targetPath, "utf8")).toBe("second\n");
  });

  it("applies explicit fileMode when provided to writeFileNode", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const filePath = join(workspace, "ssh", "id_rsa");

    await writeFileNode(
      filePath,
      {
        contents: "private-key-content\n",
        executable: false,
      },
      0o600,
    );

    const stats = await lstat(filePath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("falls back to executable mode when fileMode is not provided", async () => {
    if (process.platform === "win32") {
      return;
    }

    const workspace = await createWorkspace();
    const filePath = join(workspace, "bin", "script.sh");

    await writeFileNode(filePath, {
      contents: "#!/bin/sh\n",
      executable: true,
    });

    const stats = await lstat(filePath);
    expect(stats.mode & 0o777).toBe(0o755);
  });
});
