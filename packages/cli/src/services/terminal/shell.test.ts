import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  COMSPEC: undefined as string | undefined,
  DEVSYNC_CD_ARGS: undefined as string | undefined,
  DEVSYNC_CD_COMMAND: undefined as string | undefined,
  HOME: undefined as string | undefined,
  SHELL: undefined as string | undefined,
  XDG_CONFIG_HOME: undefined as string | undefined,
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

import { DevsyncError } from "#app/lib/error.ts";
import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";

import {
  launchShellInDirectory,
  resolveShellCommandForPlatform,
} from "./shell.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("devsync-shell-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  vi.restoreAllMocks();

  mockEnv.COMSPEC = undefined;
  mockEnv.DEVSYNC_CD_ARGS = undefined;
  mockEnv.DEVSYNC_CD_COMMAND = undefined;
  mockEnv.HOME = undefined;
  mockEnv.SHELL = undefined;
  mockEnv.XDG_CONFIG_HOME = undefined;

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("shell launcher", () => {
  it("resolves platform defaults from standard shell environment variables", async () => {
    mockEnv.SHELL = "/bin/zsh";
    expect(await resolveShellCommandForPlatform("linux")).toEqual({
      args: [],
      command: "/bin/zsh",
    });

    mockEnv.SHELL = undefined;
    expect(await resolveShellCommandForPlatform("wsl")).toEqual({
      args: [],
      command: "/bin/sh",
    });

    mockEnv.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
    expect(
      await resolveShellCommandForPlatform("win", {
        initialWindowsProcessId: 1,
        inspectWindowsProcess: vi.fn(async () => undefined),
      }),
    ).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
  });

  it("uses explicit command overrides when configured", async () => {
    const inspectWindowsProcess = vi.fn(async () => {
      throw new Error("override should short-circuit Windows inspection");
    });

    mockEnv.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
    mockEnv.DEVSYNC_CD_ARGS = '["-i","--noprofile"]';
    mockEnv.DEVSYNC_CD_COMMAND = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    expect(
      await resolveShellCommandForPlatform("win", {
        initialWindowsProcessId: 1,
        inspectWindowsProcess,
      }),
    ).toEqual({
      args: ["-i", "--noprofile"],
      command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    });
    expect(inspectWindowsProcess).not.toHaveBeenCalled();
  });

  it("prefers the invoking PowerShell over wrapper cmd.exe on Windows", async () => {
    const inspectWindowsProcess = vi.fn(async (processId: number) => {
      if (processId === 200) {
        return {
          commandLine:
            '"C:\\Windows\\System32\\cmd.exe" /d /s /c ""C:\\Users\\test\\AppData\\Roaming\\npm\\devsync.cmd" cd"',
          executablePath: "C:\\Windows\\System32\\cmd.exe",
          name: "cmd.exe",
          parentProcessId: 150,
          processId,
        };
      }

      if (processId === 150) {
        return {
          commandLine: '"C:\\Program Files\\PowerShell\\7\\pwsh.exe"',
          executablePath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
          name: "pwsh.exe",
          parentProcessId: 1,
          processId,
        };
      }

      return undefined;
    });

    mockEnv.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
    expect(
      await resolveShellCommandForPlatform("win", {
        initialWindowsProcessId: 200,
        inspectWindowsProcess,
      }),
    ).toEqual({
      args: [],
      command: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    });
    expect(inspectWindowsProcess).toHaveBeenCalledTimes(2);
  });

  it("keeps interactive cmd.exe sessions on Windows", async () => {
    const inspectWindowsProcess = vi.fn(async (processId: number) => {
      if (processId === 200) {
        return {
          commandLine: '"C:\\Windows\\System32\\cmd.exe"',
          executablePath: "C:\\Windows\\System32\\cmd.exe",
          name: "cmd.exe",
          parentProcessId: 150,
          processId,
        };
      }

      return undefined;
    });

    mockEnv.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
    expect(
      await resolveShellCommandForPlatform("win", {
        initialWindowsProcessId: 200,
        inspectWindowsProcess,
      }),
    ).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(inspectWindowsProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid command override arguments", async () => {
    mockEnv.DEVSYNC_CD_ARGS = '{"interactive":true}';
    mockEnv.DEVSYNC_CD_COMMAND = "/bin/bash";
    await expect(resolveShellCommandForPlatform("linux")).rejects.toThrowError(
      DevsyncError,
    );
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

    mockEnv.DEVSYNC_CD_ARGS = JSON.stringify([shellScript]);
    mockEnv.DEVSYNC_CD_COMMAND = process.execPath;
    Reflect.set(process.env, "DEVSYNC_SHELL_MARKER", markerFile);

    try {
      await launchShellInDirectory(syncDirectory);
    } finally {
      Reflect.deleteProperty(process.env, "DEVSYNC_SHELL_MARKER");
    }

    expect(await readFile(markerFile, "utf8")).toBe(syncDirectory);
  });
});
