import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  expandConfiguredPath,
  expandHomePath,
  expandWindowsEnvVars,
  resolveConfiguredAbsolutePath,
  resolveDotweaveConfigDirectory,
  resolveDotweaveHomeDirectory,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";

const readEnv =
  (environment: Record<string, string | undefined>) => (name: string) =>
    environment[name];

describe("resolveHomeDirectory", () => {
  it("uses HOME environment variable when set", () => {
    expect(resolveHomeDirectory("/tmp/home")).toBe(resolve("/tmp/home"));
  });

  it("ignores blank HOME", () => {
    const result = resolveHomeDirectory("  ");
    expect(result).toBeTruthy();
    expect(result).not.toBe("");
  });
});

describe("resolveXdgConfigHome", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(resolveXdgConfigHome(undefined, "/custom/config")).toBe(
      resolve("/custom/config"),
    );
  });

  it("falls back to ~/.config on all platforms", () => {
    expect(resolveXdgConfigHome("/tmp/home", undefined)).toBe(
      resolve("/tmp/home", ".config"),
    );
  });
});

describe("resolveDotweaveConfigDirectory", () => {
  it("appends dotweave to config home", () => {
    expect(resolveDotweaveConfigDirectory("/custom/config")).toBe(
      resolve("/custom/config", "dotweave"),
    );
  });
});

describe("resolveDotweaveHomeDirectory", () => {
  it("uses DOTWEAVE_HOME when set", () => {
    expect(
      resolveDotweaveHomeDirectory({
        dotweaveHome: "/custom/dotweave",
        home: "/tmp/home",
        platform: "linux",
      }),
    ).toBe(resolve("/custom/dotweave"));
  });

  it("trims DOTWEAVE_HOME before resolving", () => {
    expect(
      resolveDotweaveHomeDirectory({
        dotweaveHome: "  /custom/dotweave  ",
        home: "/tmp/home",
        platform: "linux",
      }),
    ).toBe(resolve("/custom/dotweave"));
  });

  it("uses APPDATA/dotweave by default on Windows", () => {
    expect(
      resolveDotweaveHomeDirectory({
        appData: "C:\\Users\\test\\AppData\\Roaming",
        home: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe(resolve("C:\\Users\\test\\AppData\\Roaming", "dotweave"));
  });

  it("falls back to LOCALAPPDATA/dotweave on Windows when APPDATA is unset", () => {
    expect(
      resolveDotweaveHomeDirectory({
        localAppData: "C:\\Users\\test\\AppData\\Local",
        home: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe(resolve("C:\\Users\\test\\AppData\\Local", "dotweave"));
  });

  it("falls back to USERPROFILE/AppData/Roaming/dotweave on Windows", () => {
    expect(
      resolveDotweaveHomeDirectory({
        home: undefined,
        platform: "win32",
        userProfile: "C:\\Users\\test",
      }),
    ).toBe(resolve("C:\\Users\\test", "AppData", "Roaming", "dotweave"));
  });

  it("falls back to os homedir on Windows instead of HOME when app-data variables are unset", () => {
    expect(
      resolveDotweaveHomeDirectory({
        home: "C:\\msys64\\home\\test",
        osHomeDirectory: "C:\\Users\\test",
        platform: "win32",
      }),
    ).toBe(resolve("C:\\Users\\test", "AppData", "Roaming", "dotweave"));
  });

  it("keeps XDG_CONFIG_HOME/dotweave on non-Windows", () => {
    expect(
      resolveDotweaveHomeDirectory({
        home: "/home/test",
        platform: "linux",
        xdgConfigHome: "/custom/config",
      }),
    ).toBe(resolve("/custom/config", "dotweave"));
  });

  it("keeps ~/.config/dotweave fallback on non-Windows", () => {
    expect(
      resolveDotweaveHomeDirectory({
        home: "/home/test",
        platform: "linux",
      }),
    ).toBe(resolve("/home/test", ".config", "dotweave"));
  });
});

describe("expandHomePath", () => {
  it("expands ~ to home directory", () => {
    expect(expandHomePath("~", "/tmp/home")).toBe(resolve("/tmp/home"));
  });

  it("expands ~/ prefix", () => {
    expect(expandHomePath("~/.gitconfig", "/tmp/home")).toBe(
      resolve("/tmp/home", ".gitconfig"),
    );
  });

  it("leaves absolute paths unchanged", () => {
    expect(expandHomePath("/absolute/path", "/tmp/home")).toBe(
      "/absolute/path",
    );
  });
});

describe("expandConfiguredPath", () => {
  it("expands $XDG_CONFIG_HOME", () => {
    expect(
      expandConfiguredPath("$XDG_CONFIG_HOME", undefined, "/custom/config"),
    ).toBe(resolve("/custom/config"));
  });

  it("expands $XDG_CONFIG_HOME/ prefix", () => {
    expect(
      expandConfiguredPath(
        "$XDG_CONFIG_HOME/dotweave/keys.txt",
        undefined,
        "/custom/config",
      ),
    ).toBe(resolve("/custom/config", "dotweave", "keys.txt"));
  });

  it("expands ${XDG_CONFIG_HOME} braced syntax", () => {
    expect(
      expandConfiguredPath(
        "${XDG_CONFIG_HOME}/dotweave",
        undefined,
        "/custom/config",
      ),
    ).toBe(resolve("/custom/config", "dotweave"));
  });
});

describe("resolveConfiguredAbsolutePath", () => {
  it("resolves absolute paths", () => {
    expect(
      resolveConfiguredAbsolutePath("/absolute/path", undefined, undefined),
    ).toBe(resolve("/absolute/path"));
  });

  it("throws for relative paths", () => {
    expect(() =>
      resolveConfiguredAbsolutePath("relative/path", undefined, undefined),
    ).toThrow(/must be absolute/u);
  });

  it("resolves ~ prefixed paths", () => {
    expect(
      resolveConfiguredAbsolutePath("~/.gitconfig", "/tmp/home", undefined),
    ).toBe(resolve("/tmp/home", ".gitconfig"));
  });

  it("resolves %LOCALAPPDATA% paths when readEnv is provided", () => {
    expect(
      resolveConfiguredAbsolutePath(
        "%LOCALAPPDATA%/app",
        undefined,
        undefined,
        readEnv({
          LOCALAPPDATA: "/tmp/appdata",
        }),
      ),
    ).toBe(resolve("/tmp/appdata", "app"));
  });

  it("resolves ~ paths with readEnv", () => {
    expect(
      resolveConfiguredAbsolutePath(
        "~/.config/app",
        "/tmp/home",
        undefined,
        readEnv({}),
      ),
    ).toBe(resolve("/tmp/home", ".config", "app"));
  });

  it("throws for relative paths with readEnv", () => {
    expect(() =>
      resolveConfiguredAbsolutePath(
        "relative/path",
        undefined,
        undefined,
        readEnv({}),
      ),
    ).toThrow(/must be absolute/u);
  });
});

describe("expandWindowsEnvVars", () => {
  it("expands %LOCALAPPDATA% variable", () => {
    expect(
      expandWindowsEnvVars(
        "%LOCALAPPDATA%/app/config",
        readEnv({
          LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
        }),
      ),
    ).toBe("C:\\Users\\test\\AppData\\Local/app/config");
  });

  it("expands multiple variables", () => {
    expect(
      expandWindowsEnvVars(
        "%DRIVE%/%FOLDER%",
        readEnv({
          DRIVE: "C:",
          FOLDER: "Users",
        }),
      ),
    ).toBe("C:/Users");
  });

  it("throws when variable is not defined", () => {
    expect(() =>
      expandWindowsEnvVars("%MISSING_VAR%/path", readEnv({})),
    ).toThrow(/%MISSING_VAR%/u);
  });

  it("returns string unchanged when no % tokens present", () => {
    expect(expandWindowsEnvVars("~/.config/app", readEnv({}))).toBe(
      "~/.config/app",
    );
  });

  it("handles empty %% token without matching", () => {
    expect(expandWindowsEnvVars("%%", readEnv({}))).toBe("%%");
  });

  it("throws for variable with whitespace-only value", () => {
    expect(() =>
      expandWindowsEnvVars("%VAR%/path", readEnv({ VAR: "  " })),
    ).toThrow(/%VAR%/u);
  });
});

describe("expandConfiguredPath with readEnv", () => {
  it("expands %LOCALAPPDATA% then resolves", () => {
    expect(
      expandConfiguredPath(
        "%LOCALAPPDATA%/app",
        undefined,
        undefined,
        readEnv({
          LOCALAPPDATA: "/tmp/appdata",
        }),
      ),
    ).toBe("/tmp/appdata/app");
  });

  it("expands ~ paths with readEnv", () => {
    expect(
      expandConfiguredPath(
        "~/.config/app",
        "/tmp/home",
        undefined,
        readEnv({}),
      ),
    ).toBe(resolve("/tmp/home", ".config", "app"));
  });

  it("expands $XDG_CONFIG_HOME paths with readEnv", () => {
    expect(
      expandConfiguredPath(
        "$XDG_CONFIG_HOME/app",
        undefined,
        "/custom/config",
        readEnv({}),
      ),
    ).toBe(resolve("/custom/config", "app"));
  });
});
