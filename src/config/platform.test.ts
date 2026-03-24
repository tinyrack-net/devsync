import { describe, expect, it, vi } from "vitest";

import {
  detectCurrentPlatformKey,
  resolveDefaultLocalPath,
  resolveLocalPathForPlatform,
} from "#app/config/platform.js";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();

  return { ...actual, platform: vi.fn(() => "linux") };
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

    expect(detectCurrentPlatformKey()).toBe("linux");
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
});

describe("resolveDefaultLocalPath", () => {
  it("returns default from object", () => {
    expect(
      resolveDefaultLocalPath({
        default: "~/.config/app",
        linux: "$XDG_CONFIG_HOME/app",
      }),
    ).toBe("~/.config/app");
  });
});
