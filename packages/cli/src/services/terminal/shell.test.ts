import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  COMSPEC: undefined as string | undefined,
  HOME: undefined as string | undefined,
  SHELL: undefined as string | undefined,
  XDG_CONFIG_HOME: undefined as string | undefined,
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

vi.mock("#app/config/runtime-env.ts", () => ({
  resolveCurrentPlatformKey: () => "linux",
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
  });
});
