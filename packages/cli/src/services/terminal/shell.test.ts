import { afterEach, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";

mock.module("node:child_process", () => ({
  spawn: mock(),
}));

mock.module("#app/lib/env.ts", () => ({
  ENV: {
    COMSPEC: undefined as string | undefined,
    HOME: undefined as string | undefined,
    SHELL: undefined as string | undefined,
    XDG_CONFIG_HOME: undefined as string | undefined,
  },
}));

mock.module("#app/config/runtime-env.ts", () => ({
  resolveCurrentPlatformKey: () => "linux",
}));

import { spawn as spawnMock } from "node:child_process";
import { ENV } from "#app/lib/env.ts";
import { createTemporaryDirectory } from "../../test/helpers/sync-fixture.ts";

import {
  launchShellInDirectory,
  resolveShellCommandForPlatform,
} from "./shell.ts";

type MockFn = ReturnType<typeof mock>;

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-shell-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  mock.clearAllMocks();

  ENV.COMSPEC = undefined;
  ENV.HOME = undefined;
  ENV.SHELL = undefined;
  ENV.XDG_CONFIG_HOME = undefined;

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("shell launcher", () => {
  it("resolves platform defaults from standard shell environment variables", async () => {
    ENV.SHELL = "/bin/zsh";
    expect(await resolveShellCommandForPlatform("linux")).toEqual({
      args: [],
      command: "/bin/zsh",
    });

    ENV.SHELL = undefined;
    expect(await resolveShellCommandForPlatform("wsl")).toEqual({
      args: [],
      command: "/bin/sh",
    });

    ENV.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
    expect(
      await resolveShellCommandForPlatform("win", {
        initialWindowsProcessId: 1,
        inspectWindowsProcess: mock(async () => undefined),
      }),
    ).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
  });

  it("prefers the invoking PowerShell over wrapper cmd.exe on Windows", async () => {
    const inspectWindowsProcess = mock(async (processId: number) => {
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

    ENV.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
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
    const inspectWindowsProcess = mock(async (processId: number) => {
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

    ENV.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
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
        on: MockFn;
        setEncoding: MockFn;
      };
    };

    ENV.SHELL = "/bin/zsh";
    (spawnMock as MockFn).mockImplementation(
      (command: string, args: string[], options: Record<string, unknown>) => {
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
      },
    );

    await expect(
      launchShellInDirectory(shellDirectory),
    ).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
