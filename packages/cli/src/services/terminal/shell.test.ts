import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  COMSPEC: undefined as string | undefined,
  HOME: undefined as string | undefined,
  SHELL: undefined as string | undefined,
  XDG_CONFIG_HOME: undefined as string | undefined,
}));

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();

  return {
    ...actual,
    spawn: spawnMock,
  };
});

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

vi.mock("#app/config/runtime-env.ts", () => ({
  resolveCurrentPlatformKey: () => "linux",
}));

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";

import {
  launchShellInDirectory,
  resolveShellCommandForPlatform,
} from "./shell.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-shell-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  vi.restoreAllMocks();

  mockEnv.COMSPEC = undefined;
  mockEnv.HOME = undefined;
  mockEnv.SHELL = undefined;
  mockEnv.XDG_CONFIG_HOME = undefined;
  spawnMock.mockReset();

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

  it("prefers the invoking PowerShell over wrapper cmd.exe on Windows", async () => {
    const inspectWindowsProcess = vi.fn(async (processId: number) => {
      if (processId === 200) {
        return {
          commandLine:
            '"C:\\Windows\\System32\\cmd.exe" /d /s /c ""C:\\Users\\test\\AppData\\Roaming\\npm\\dotweave.cmd" cd"',
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

  it("launches the resolved command in the requested directory", async () => {
    const workspace = await createWorkspace();
    const shellDirectory = `${workspace}/sync`;
    const child = new EventEmitter() as EventEmitter & {
      stdout?: {
        on: ReturnType<typeof vi.fn>;
        setEncoding: ReturnType<typeof vi.fn>;
      };
    };

    mockEnv.SHELL = "/bin/zsh";
    spawnMock.mockImplementation((command, args, options) => {
      expect(command).toBe("/bin/zsh");
      expect(args).toEqual([]);
      expect(options).toMatchObject({
        cwd: shellDirectory,
        env: process.env,
        stdio: "inherit",
      });
      queueMicrotask(() => {
        child.emit("close", 0, null);
      });

      return child;
    });

    await expect(
      launchShellInDirectory(shellDirectory),
    ).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
