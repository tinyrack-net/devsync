import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  vi.restoreAllMocks();

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("shell launcher", () => {
  it("resolves platform defaults from standard shell environment variables", async () => {
    expect(
      await resolveShellCommandForPlatform("linux", {
        SHELL: "/bin/zsh",
      }),
    ).toEqual({
      args: [],
      command: "/bin/zsh",
    });
    expect(await resolveShellCommandForPlatform("wsl", {})).toEqual({
      args: [],
      command: "/bin/sh",
    });
    expect(
      await resolveShellCommandForPlatform(
        "win",
        {
          COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        },
        {
          initialWindowsProcessId: 1,
          inspectWindowsProcess: vi.fn(async () => undefined),
        },
      ),
    ).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
  });

  it("uses explicit command overrides when configured", async () => {
    const inspectWindowsProcess = vi.fn(async () => {
      throw new Error("override should short-circuit Windows inspection");
    });

    expect(
      await resolveShellCommandForPlatform(
        "win",
        {
          COMSPEC: "C:\\Windows\\System32\\cmd.exe",
          DEVSYNC_CD_ARGS: '["-i","--noprofile"]',
          DEVSYNC_CD_COMMAND: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        },
        {
          initialWindowsProcessId: 1,
          inspectWindowsProcess,
        },
      ),
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

    expect(
      await resolveShellCommandForPlatform(
        "win",
        {
          COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        },
        {
          initialWindowsProcessId: 200,
          inspectWindowsProcess,
        },
      ),
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

    expect(
      await resolveShellCommandForPlatform(
        "win",
        {
          COMSPEC: "C:\\Windows\\System32\\cmd.exe",
        },
        {
          initialWindowsProcessId: 200,
          inspectWindowsProcess,
        },
      ),
    ).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(inspectWindowsProcess).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid command override arguments", async () => {
    await expect(
      resolveShellCommandForPlatform("linux", {
        DEVSYNC_CD_ARGS: '{"interactive":true}',
        DEVSYNC_CD_COMMAND: "/bin/bash",
      }),
    ).rejects.toThrowError(DevsyncError);
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
