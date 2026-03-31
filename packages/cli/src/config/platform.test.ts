import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectCurrentPlatformKey,
  resolveLocalPathForPlatform,
} from "#app/config/platform.ts";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return {
    ...actual,
    platform: vi.fn(() => "linux"),
    release: vi.fn(() => "6.6.0"),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("detectCurrentPlatformKey", () => {
  it("maps win32 to win", async () => {
    const os = await import("node:os");
    vi.mocked(os.platform).mockReturnValue("win32");

    expect(detectCurrentPlatformKey()).toBe("win");
  });

  it("maps darwin to mac", async () => {
    const os = await import("node:os");
    vi.mocked(os.platform).mockReturnValue("darwin");

    expect(detectCurrentPlatformKey()).toBe("mac");
  });

  it("maps linux to linux", async () => {
    const os = await import("node:os");
    vi.mocked(os.platform).mockReturnValue("linux");
    vi.mocked(os.release).mockReturnValue("6.6.0");

    expect(detectCurrentPlatformKey({})).toBe("linux");
  });

  it("maps linux with WSL markers to wsl", async () => {
    const os = await import("node:os");
    vi.mocked(os.platform).mockReturnValue("linux");
    vi.mocked(os.release).mockReturnValue("6.6.87.2-microsoft-standard-WSL2");

    expect(detectCurrentPlatformKey()).toBe("wsl");
  });

  it("maps unknown platforms to linux", async () => {
    const os = await import("node:os");
    vi.mocked(os.platform).mockReturnValue("freebsd" as NodeJS.Platform);

    expect(detectCurrentPlatformKey()).toBe("linux");
  });
});

describe("resolveLocalPathForPlatform", () => {
  it("returns platform-specific path when available", () => {
    const localPath = {
      default: "~/.config/app",
      linux: "$XDG_CONFIG_HOME/app",
      mac: "~/Library/Application Support/app",
      win: "%LOCALAPPDATA%/app",
    };

    expect(resolveLocalPathForPlatform(localPath, "linux")).toBe(
      "$XDG_CONFIG_HOME/app",
    );
    expect(resolveLocalPathForPlatform(localPath, "mac")).toBe(
      "~/Library/Application Support/app",
    );
    expect(resolveLocalPathForPlatform(localPath, "win")).toBe(
      "%LOCALAPPDATA%/app",
    );
  });

  it("falls back to default when platform key is absent", () => {
    const localPath = {
      default: "~/.config/app",
      linux: "$XDG_CONFIG_HOME/app",
    };

    expect(resolveLocalPathForPlatform(localPath, "win")).toBe("~/.config/app");
    expect(resolveLocalPathForPlatform(localPath, "mac")).toBe("~/.config/app");
  });

  it("returns default when only default is specified", () => {
    const localPath = { default: "~/.config/app" };

    expect(resolveLocalPathForPlatform(localPath, "linux")).toBe(
      "~/.config/app",
    );
    expect(resolveLocalPathForPlatform(localPath, "win")).toBe("~/.config/app");
  });

  it("prefers wsl and falls back to linux on WSL", () => {
    expect(
      resolveLocalPathForPlatform(
        {
          default: "~/.config/app",
          linux: "$XDG_CONFIG_HOME/app-linux",
          wsl: "$XDG_CONFIG_HOME/app-wsl",
        },
        "wsl",
      ),
    ).toBe("$XDG_CONFIG_HOME/app-wsl");

    expect(
      resolveLocalPathForPlatform(
        {
          default: "~/.config/app",
          linux: "$XDG_CONFIG_HOME/app-linux",
        },
        "wsl",
      ),
    ).toBe("$XDG_CONFIG_HOME/app-linux");
  });
});
