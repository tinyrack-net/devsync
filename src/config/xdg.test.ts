import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  expandConfiguredPath,
  expandHomePath,
  resolveConfiguredAbsolutePath,
  resolveDevsyncConfigDirectory,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";

const stubPlatform = (platform: string) => {
  vi.stubGlobal("process", { ...process, platform });
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveHomeDirectory", () => {
  it("uses HOME environment variable when set", () => {
    expect(resolveHomeDirectory({ HOME: "/tmp/home" })).toBe(
      resolve("/tmp/home"),
    );
  });

  it("ignores blank HOME", () => {
    const result = resolveHomeDirectory({ HOME: "  " });
    expect(result).toBeTruthy();
    expect(result).not.toBe("");
  });
});

describe("resolveXdgConfigHome", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(
      resolveXdgConfigHome({ XDG_CONFIG_HOME: "/custom/config" }),
    ).toBe(resolve("/custom/config"));
  });

  it("falls back to ~/.config on non-Windows platforms", () => {
    stubPlatform("linux");
    expect(resolveXdgConfigHome({ HOME: "/tmp/home" })).toBe(
      resolve("/tmp/home", ".config"),
    );
  });

  it("falls back to ~/.config on darwin", () => {
    stubPlatform("darwin");
    expect(resolveXdgConfigHome({ HOME: "/tmp/home" })).toBe(
      resolve("/tmp/home", ".config"),
    );
  });

  it("uses APPDATA on Windows when available", () => {
    stubPlatform("win32");
    expect(
      resolveXdgConfigHome({
        HOME: "C:\\Users\\test",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      }),
    ).toBe(resolve("C:\\Users\\test\\AppData\\Roaming"));
  });

  it("falls back to homedir/AppData/Roaming on Windows without APPDATA", () => {
    stubPlatform("win32");
    expect(resolveXdgConfigHome({ HOME: "C:\\Users\\test" })).toBe(
      resolve("C:\\Users\\test", "AppData", "Roaming"),
    );
  });

  it("prefers XDG_CONFIG_HOME over APPDATA on Windows", () => {
    stubPlatform("win32");
    expect(
      resolveXdgConfigHome({
        XDG_CONFIG_HOME: "D:\\custom\\config",
        APPDATA: "C:\\Users\\test\\AppData\\Roaming",
      }),
    ).toBe(resolve("D:\\custom\\config"));
  });
});

describe("resolveDevsyncConfigDirectory", () => {
  it("appends devsync to config home", () => {
    expect(
      resolveDevsyncConfigDirectory({ XDG_CONFIG_HOME: "/custom/config" }),
    ).toBe(resolve("/custom/config", "devsync"));
  });
});

describe("expandHomePath", () => {
  it("expands ~ to home directory", () => {
    expect(expandHomePath("~", { HOME: "/tmp/home" })).toBe(
      resolve("/tmp/home"),
    );
  });

  it("expands ~/ prefix", () => {
    expect(expandHomePath("~/.gitconfig", { HOME: "/tmp/home" })).toBe(
      resolve("/tmp/home", ".gitconfig"),
    );
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHomePath("/absolute/path", { HOME: "/tmp/home" })).toBe(
      "/absolute/path",
    );
  });
});

describe("expandConfiguredPath", () => {
  it("expands $XDG_CONFIG_HOME", () => {
    expect(
      expandConfiguredPath("$XDG_CONFIG_HOME", {
        XDG_CONFIG_HOME: "/custom/config",
      }),
    ).toBe(resolve("/custom/config"));
  });

  it("expands $XDG_CONFIG_HOME/ prefix", () => {
    expect(
      expandConfiguredPath("$XDG_CONFIG_HOME/devsync/age/keys.txt", {
        XDG_CONFIG_HOME: "/custom/config",
      }),
    ).toBe(resolve("/custom/config", "devsync", "age", "keys.txt"));
  });

  it("expands ${XDG_CONFIG_HOME} braced syntax", () => {
    expect(
      expandConfiguredPath("${XDG_CONFIG_HOME}/devsync", {
        XDG_CONFIG_HOME: "/custom/config",
      }),
    ).toBe(resolve("/custom/config", "devsync"));
  });
});

describe("resolveConfiguredAbsolutePath", () => {
  it("resolves absolute paths", () => {
    expect(resolveConfiguredAbsolutePath("/absolute/path")).toBe(
      resolve("/absolute/path"),
    );
  });

  it("throws for relative paths", () => {
    expect(() => resolveConfiguredAbsolutePath("relative/path")).toThrow(
      /must be absolute/u,
    );
  });
});

describe("resolveHomeConfiguredAbsolutePath", () => {
  it("resolves ~ prefixed paths", () => {
    expect(
      resolveHomeConfiguredAbsolutePath("~/.gitconfig", {
        HOME: "/tmp/home",
      }),
    ).toBe(resolve("/tmp/home", ".gitconfig"));
  });

  it("throws for relative paths without ~", () => {
    expect(() => resolveHomeConfiguredAbsolutePath("relative/path")).toThrow(
      /must be absolute/u,
    );
  });
});
