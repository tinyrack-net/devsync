import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ApplicationContext } from "@stricli/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proposePathCompletions } from "./path-completion.ts";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
  };
});

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "dotweave-path-complete-"),
  );

  temporaryDirectories.push(directory);

  return directory;
};

const createContext = (): ApplicationContext => {
  return {
    process: {
      stdout: process.stdout,
      stderr: process.stderr,
    },
  };
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }

  vi.restoreAllMocks();
});

describe("path completions", () => {
  it("completes relative entries and hides dotfiles by default", async () => {
    const workspace = await createWorkspace();

    await writeFile(path.join(workspace, "file-alpha.txt"), "", "utf8");
    await writeFile(path.join(workspace, ".secret"), "", "utf8");
    await mkdir(path.join(workspace, "folder-beta"));

    const originalCwd = process.cwd;
    process.cwd = () => workspace;

    try {
      const context = createContext();

      await expect(proposePathCompletions.call(context, "f")).resolves.toEqual([
        "file-alpha.txt",
        "folder-beta/",
      ]);
      await expect(proposePathCompletions.call(context, ".s")).resolves.toEqual(
        [".secret"],
      );
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("completes home-relative and absolute paths", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = path.join(workspace, "home");
    const nestedDirectory = path.join(homeDirectory, ".config");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(path.join(nestedDirectory, "dotweave.toml"), "", "utf8");
    await mkdir(path.join(nestedDirectory, "nvim"));

    const os = await import("node:os");
    vi.mocked(os.homedir).mockReturnValue(homeDirectory);

    const context = createContext();

    await expect(
      proposePathCompletions.call(context, "~/.config/d"),
    ).resolves.toEqual(["~/.config/dotweave.toml"]);
    await expect(
      proposePathCompletions.call(context, `${nestedDirectory}/n`),
    ).resolves.toEqual([`${nestedDirectory}/nvim/`]);
  });

  it("returns an empty list for recoverable filesystem errors", async () => {
    const context = createContext();

    await expect(
      proposePathCompletions.call(context, "nonexistent-path-prefix/"),
    ).resolves.toEqual([]);
  });

  it("appends trailing slash to directory completions", async () => {
    const workspace = await createWorkspace();

    await mkdir(path.join(workspace, "docs"));

    const originalCwd = process.cwd;
    process.cwd = () => workspace;

    try {
      const context = createContext();

      await expect(proposePathCompletions.call(context, "d")).resolves.toEqual([
        "docs/",
      ]);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("completes nested directory paths", async () => {
    const workspace = await createWorkspace();

    await mkdir(path.join(workspace, "workspace", "project-a"), {
      recursive: true,
    });
    await mkdir(path.join(workspace, "workspace", "project-b"), {
      recursive: true,
    });

    const originalCwd = process.cwd;
    process.cwd = () => workspace;

    try {
      const context = createContext();

      await expect(
        proposePathCompletions.call(context, "workspace/"),
      ).resolves.toEqual(["workspace/project-a/", "workspace/project-b/"]);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("completes dotfile paths when explicitly prefixed with a dot", async () => {
    const workspace = await createWorkspace();

    await writeFile(path.join(workspace, ".bashrc"), "", "utf8");
    await writeFile(path.join(workspace, ".vimrc"), "", "utf8");

    const originalCwd = process.cwd;
    process.cwd = () => workspace;

    try {
      const context = createContext();

      await expect(proposePathCompletions.call(context, ".")).resolves.toEqual([
        ".bashrc",
        ".vimrc",
      ]);
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("completes paths starting with dot when explicitly prefixed", async () => {
    const workspace = await createWorkspace();
    const homeDirectory = path.join(workspace, "home");

    await mkdir(path.join(homeDirectory, ".config", "nvim"), {
      recursive: true,
    });
    await mkdir(path.join(homeDirectory, ".config", "git"), {
      recursive: true,
    });

    const os = await import("node:os");
    vi.mocked(os.homedir).mockReturnValue(homeDirectory);

    const context = createContext();

    await expect(
      proposePathCompletions.call(context, "~/.config/"),
    ).resolves.toEqual(["~/.config/git/", "~/.config/nvim/"]);
  });

  it("handles completions for paths with no matches", async () => {
    const workspace = await createWorkspace();

    await writeFile(path.join(workspace, "file-alpha.txt"), "", "utf8");

    const originalCwd = process.cwd;
    process.cwd = () => workspace;

    try {
      const context = createContext();

      await expect(
        proposePathCompletions.call(context, "zzz-no-match"),
      ).resolves.toEqual([]);
    } finally {
      process.cwd = originalCwd;
    }
  });
});
