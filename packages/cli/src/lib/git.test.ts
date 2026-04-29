import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { DotweaveError } from "#app/lib/error.ts";
import {
  ensureGitRepository,
  ensureRepository,
  initializeRepository,
} from "#app/lib/git.ts";
import {
  createTemporaryDirectory,
  runGit,
} from "../test/helpers/sync-fixture.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-git-");

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

describe("git helpers", () => {
  it("initializes a repository with a main branch", async () => {
    const workspace = await createWorkspace();
    const repositoryPath = join(workspace, "sync");

    await expect(initializeRepository(repositoryPath)).resolves.toEqual({
      action: "initialized",
    });
    await expect(ensureRepository(repositoryPath)).resolves.toBeUndefined();
    await expect(
      runGit(["-C", repositoryPath, "symbolic-ref", "--short", "HEAD"]),
    ).resolves.toMatchObject({
      stdout: "main\n",
    });
  });

  it("clones an existing repository and reports the source", async () => {
    const workspace = await createWorkspace();
    const sourcePath = join(workspace, "source");
    const targetPath = join(workspace, "clone");

    await runGit(["init", "-b", "main", sourcePath], workspace);

    await expect(initializeRepository(targetPath, sourcePath)).resolves.toEqual(
      {
        action: "cloned",
        source: sourcePath,
      },
    );
    await expect(ensureRepository(targetPath)).resolves.toBeUndefined();
  });

  it("wraps missing git repositories in a DotweaveError", async () => {
    const workspace = await createWorkspace();
    const missingRepositoryPath = join(workspace, "not-a-repo");

    await expect(
      ensureRepository(missingRepositoryPath),
    ).rejects.toThrowError();
    await expect(
      ensureGitRepository(missingRepositoryPath),
    ).rejects.toThrowError(DotweaveError);
    await expect(
      ensureGitRepository(missingRepositoryPath),
    ).rejects.toThrowError(/Sync repository is not initialized/u);
  });

  it("fails to initialize a repository in a non-writable location", async () => {
    const workspace = await createWorkspace();
    const fileParentPath = join(workspace, "not-a-directory");

    await writeFile(fileParentPath, "not a directory");

    await expect(
      initializeRepository(join(fileParentPath, "repo")),
    ).rejects.toThrow();
  });
});
