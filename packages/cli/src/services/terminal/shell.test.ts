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

import { resolveShellCommandForPlatform } from "./shell.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
    expect(await resolveShellCommandForPlatform("win")).toEqual({
      args: [],
      command: "C:\\Windows\\System32\\cmd.exe",
    });
  });
});
