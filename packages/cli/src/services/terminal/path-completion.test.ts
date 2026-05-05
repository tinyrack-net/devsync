import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import type { DotweaveCliContext } from "./cli-runtime.ts";
import { proposePathCompletions } from "./path-completion.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dotweave-path-complete-"),
  );

  temporaryDirectories.push(directory);

  return directory;
};

const createContext = (
  cwd: string,
  homeDirectory: string,
  readdirImpl: typeof fs.readdir = fs.readdir,
): DotweaveCliContext => {
  return {
    fs: {
      promises: {
        ...fs,
        readdir: readdirImpl,
      },
    },
    os: {
      homedir: () => homeDirectory,
    } as never,
    path,
    process: {
      cwd: () => cwd,
    } as never,
  };
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("path completions", () => {
  it("completes relative entries and hides dotfiles by default", async () => {
    const workspace = await createWorkspace();

    await writeFile(path.join(workspace, "file-alpha.txt"), "", "utf8");
    await writeFile(path.join(workspace, ".secret"), "", "utf8");
    await mkdir(path.join(workspace, "folder-beta"));

    const context = createContext(workspace, workspace);

    await expect(proposePathCompletions.call(context, "f")).resolves.toEqual([
      "file-alpha.txt",
      "folder-beta/",
    ]);
    await expect(proposePathCompletions.call(context, ".s")).resolves.toEqual([
      ".secret",
    ]);
  });

  it("completes home-relative and absolute paths", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = path.join(workspace, "home");
    const nestedDirectory = path.join(homeDirectory, ".config");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(path.join(nestedDirectory, "dotweave.toml"), "", "utf8");
    await mkdir(path.join(nestedDirectory, "nvim"));

    const context = createContext(workspace, homeDirectory);

    await expect(
      proposePathCompletions.call(context, "~/.config/d"),
    ).resolves.toEqual(["~/.config/dotweave.toml"]);
    await expect(
      proposePathCompletions.call(context, `${nestedDirectory}/n`),
    ).resolves.toEqual([`${nestedDirectory}/nvim/`]);
  });

  it("returns an empty list for recoverable filesystem errors", async () => {
    const workspace = await createWorkspace();
    const context = createContext(workspace, workspace, async () => {
      throw Object.assign(new Error("missing directory"), {
        code: "ENOENT",
      });
    });

    await expect(
      proposePathCompletions.call(context, "missing"),
    ).resolves.toEqual([]);
  });

  it("rethrows unexpected filesystem errors", async () => {
    const workspace = await createWorkspace();
    const context = createContext(workspace, workspace, async () => {
      throw Object.assign(new Error("disk failure"), {
        code: "EIO",
      });
    });

    await expect(
      proposePathCompletions.call(context, "anything"),
    ).rejects.toThrowError("disk failure");
  });
});
