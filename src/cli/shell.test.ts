import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DevsyncError } from "#app/services/error.js";
import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.js";

import {
  launchShellInDirectory,
  resolveShellCommandForPlatform,
} from "./shell.js";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-shell-");

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

describe("shell launcher", () => {
  it("resolves platform defaults from standard shell environment variables", () => {
    expect(
      resolveShellCommandForPlatform("linux", {
        SHELL: "/bin/zsh",
      }),
    ).toEqual({
      args: [],
      command: "/bin/zsh",
    });
    expect(resolveShellCommandForPlatform("wsl", {})).toEqual({
      args: [],
      command: "/bin/sh",
    });
    expect(
      resolveShellCommandForPlatform("win", {
        COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      }),
    ).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
  });

  it("uses explicit command overrides when configured", () => {
    expect(
      resolveShellCommandForPlatform("linux", {
        DEVSYNC_CD_ARGS: '["-i","--noprofile"]',
        DEVSYNC_CD_COMMAND: "/bin/bash",
        SHELL: "/bin/zsh",
      }),
    ).toEqual({
      args: ["-i", "--noprofile"],
      command: "/bin/bash",
    });
  });

  it("rejects invalid command override arguments", () => {
    expect(() =>
      resolveShellCommandForPlatform("linux", {
        DEVSYNC_CD_ARGS: '{"interactive":true}',
        DEVSYNC_CD_COMMAND: "/bin/bash",
      }),
    ).toThrowError(DevsyncError);
  });

  it("launches the configured command in the requested directory", async () => {
    const workspace = await createWorkspace();
    const syncDirectory = join(workspace, "sync");
    const markerFile = join(workspace, "marker.txt");
    const shellScript = join(workspace, "record-shell.mjs");

    await mkdir(syncDirectory, { recursive: true });
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

    await launchShellInDirectory(syncDirectory, {
      ...process.env,
      DEVSYNC_CD_ARGS: JSON.stringify([shellScript]),
      DEVSYNC_CD_COMMAND: process.execPath,
      DEVSYNC_SHELL_MARKER: markerFile,
    });

    expect(await readFile(markerFile, "utf8")).toBe(syncDirectory);
  });
});
