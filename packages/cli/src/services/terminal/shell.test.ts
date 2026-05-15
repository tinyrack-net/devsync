import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DotweaveError } from "#app/lib/error.ts";

const mockEnv = vi.hoisted(() => ({
  COMSPEC: undefined as string | undefined,
  HOME: undefined as string | undefined,
  SHELL: undefined as string | undefined,
  XDG_CONFIG_HOME: undefined as string | undefined,
}));

const mockRuntime = vi.hoisted(() => ({
  platformKey: "linux" as "linux" | "macos" | "win" | "wsl",
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

vi.mock("#app/config/runtime-env.ts", () => ({
  resolveCurrentPlatformKey: () => mockRuntime.platformKey,
}));

const mockSpawn = vi.hoisted(() => {
  const createChildProcess = (exitCode: number | null) => {
    const emitter = new EventEmitter();
    setTimeout(() => {
      emitter.emit("close", exitCode, null);
    }, 0);
    return emitter;
  };
  return vi.fn(createChildProcess);
});

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

import {
  launchShellInDirectory,
  resolveShellCommand,
  resolveShellCommandForPlatform,
} from "./shell.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();

  mockEnv.COMSPEC = undefined;
  mockEnv.HOME = undefined;
  mockEnv.SHELL = undefined;
  mockEnv.XDG_CONFIG_HOME = undefined;
  mockRuntime.platformKey = "linux";
  mockSpawn.mockClear();

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

describe("shell launcher", () => {
  describe("resolveShellCommandForPlatform", () => {
    it("resolves SHELL on linux", async () => {
      mockEnv.SHELL = "/bin/zsh";
      expect(await resolveShellCommandForPlatform("linux")).toEqual({
        args: [],
        command: "/bin/zsh",
      });
    });

    it("falls back to /bin/sh when SHELL is not set", async () => {
      mockEnv.SHELL = undefined;
      expect(await resolveShellCommandForPlatform("wsl")).toEqual({
        args: [],
        command: "/bin/sh",
      });
    });

    it("uses COMSPEC on windows", async () => {
      mockEnv.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
      expect(await resolveShellCommandForPlatform("win")).toEqual({
        args: [],
        command: "C:\\Windows\\System32\\cmd.exe",
      });
    });

    it("falls back to cmd.exe on windows when COMSPEC is not set", async () => {
      mockEnv.COMSPEC = undefined;
      expect(await resolveShellCommandForPlatform("win")).toEqual({
        args: [],
        command: "cmd.exe",
      });
    });
  });

  describe("resolveShellCommand", () => {
    it("delegates to resolveShellCommandForPlatform with the current platform", async () => {
      mockEnv.SHELL = "/bin/fish";
      expect(await resolveShellCommand()).toEqual({
        args: [],
        command: "/bin/fish",
      });
    });
  });

  describe("launchShellInDirectory", () => {
    it("rejects when the shell process fails to spawn", async () => {
      mockEnv.SHELL = "/nonexistent/shell";

      await expect(launchShellInDirectory("/tmp")).rejects.toThrow();
    });

    it("uses the windows shell hint when a windows shell fails to spawn", async () => {
      mockRuntime.platformKey = "win";
      mockEnv.COMSPEC = "missing-cmd.exe";
      mockSpawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => {
          emitter.emit("error", new Error("not found"));
        }, 0);
        return emitter;
      });

      await expect(launchShellInDirectory("/tmp")).rejects.toMatchObject({
        hint: "Set COMSPEC to a valid shell executable.",
      });
    });

    it("launchShellInDirectory resolves when the shell process exits successfully", async () => {
      mockEnv.SHELL = "/bin/bash";
      mockSpawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => {
          emitter.emit("close", 0, null);
        }, 0);
        return emitter;
      });

      await expect(launchShellInDirectory("/tmp")).resolves.toBeUndefined();
    });

    it("launchShellInDirectory rejects when the shell process exits non-zero", async () => {
      mockEnv.SHELL = "/bin/bash";
      mockSpawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => {
          emitter.emit("close", 1, null);
        }, 0);
        return emitter;
      });

      await expect(launchShellInDirectory("/tmp")).rejects.toThrow();
    });

    it("reports signal termination", async () => {
      mockEnv.SHELL = "/bin/bash";
      mockSpawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => {
          emitter.emit("close", null, "SIGTERM");
        }, 0);
        return emitter;
      });

      await expect(launchShellInDirectory("/tmp")).rejects.toThrow(
        "Shell exited due to signal SIGTERM.",
      );
    });

    it("uses exit code 1 when the shell closes without a code", async () => {
      mockEnv.SHELL = "/bin/bash";
      mockSpawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => {
          emitter.emit("close", null, null);
        }, 0);
        return emitter;
      });

      await expect(launchShellInDirectory("/tmp")).rejects.toMatchObject({
        exitCode: 1,
        message: "Shell exited with code unknown.",
      });
    });

    it("includes non-Error spawn error details", async () => {
      mockEnv.SHELL = "/bin/bash";
      mockSpawn.mockImplementation(() => {
        const emitter = new EventEmitter();
        setTimeout(() => {
          emitter.emit("error", "not an Error");
        }, 0);
        return emitter;
      });

      await expect(launchShellInDirectory("/tmp")).rejects.toMatchObject({
        details: ["Shell: /bin/bash", "not an Error"],
      } satisfies Partial<DotweaveError>);
    });
  });
});
