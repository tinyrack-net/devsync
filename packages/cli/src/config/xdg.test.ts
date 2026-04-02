import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  expandConfiguredPath,
  expandHomePath,
  expandPlatformConfiguredPath,
  expandWindowsEnvVars,
  resolveConfiguredAbsolutePath,
  resolveDevsyncConfigDirectory,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
  resolvePlatformConfiguredAbsolutePath,
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

describe("resolveDevsyncConfigDirectory", () => {
  it("appends devsync to config home", () => {
    expect(resolveDevsyncConfigDirectory("/custom/config")).toBe(
      resolve("/custom/config", "devsync"),
    );
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
        "$XDG_CONFIG_HOME/devsync/keys.txt",
        undefined,
        "/custom/config",
      ),
    ).toBe(resolve("/custom/config", "devsync", "keys.txt"));
  });

  it("expands ${XDG_CONFIG_HOME} braced syntax", () => {
    expect(
      expandConfiguredPath(
        "${XDG_CONFIG_HOME}/devsync",
        undefined,
        "/custom/config",
      ),
    ).toBe(resolve("/custom/config", "devsync"));
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
});

describe("resolveHomeConfiguredAbsolutePath", () => {
  it("resolves ~ prefixed paths", () => {
    expect(resolveHomeConfiguredAbsolutePath("~/.gitconfig", "/tmp/home")).toBe(
      resolve("/tmp/home", ".gitconfig"),
    );
  });

  it("throws for relative paths without ~", () => {
    expect(() =>
      resolveHomeConfiguredAbsolutePath("relative/path", "/tmp/home"),
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

describe("expandPlatformConfiguredPath", () => {
  it("expands %LOCALAPPDATA% then resolves", () => {
    expect(
      expandPlatformConfiguredPath(
        "%LOCALAPPDATA%/app",
        undefined,
        undefined,
        readEnv({
          LOCALAPPDATA: "/tmp/appdata",
        }),
      ),
    ).toBe("/tmp/appdata/app");
  });

  it("expands ~ paths", () => {
    expect(
      expandPlatformConfiguredPath(
        "~/.config/app",
        "/tmp/home",
        undefined,
        readEnv({}),
      ),
    ).toBe(resolve("/tmp/home", ".config", "app"));
  });

  it("expands $XDG_CONFIG_HOME paths", () => {
    expect(
      expandPlatformConfiguredPath(
        "$XDG_CONFIG_HOME/app",
        undefined,
        "/custom/config",
        readEnv({}),
      ),
    ).toBe(resolve("/custom/config", "app"));
  });
});

describe("resolvePlatformConfiguredAbsolutePath", () => {
  it("resolves %LOCALAPPDATA% paths", () => {
    expect(
      resolvePlatformConfiguredAbsolutePath(
        "%LOCALAPPDATA%/app",
        undefined,
        undefined,
        readEnv({
          LOCALAPPDATA: "/tmp/appdata",
        }),
      ),
    ).toBe(resolve("/tmp/appdata", "app"));
  });

  it("resolves ~ paths", () => {
    expect(
      resolvePlatformConfiguredAbsolutePath(
        "~/.config/app",
        "/tmp/home",
        undefined,
        readEnv({}),
      ),
    ).toBe(resolve("/tmp/home", ".config", "app"));
  });

  it("throws for relative paths", () => {
    expect(() =>
      resolvePlatformConfiguredAbsolutePath(
        "relative/path",
        undefined,
        undefined,
        readEnv({}),
      ),
    ).toThrow(/must be absolute/u);
  });
});
