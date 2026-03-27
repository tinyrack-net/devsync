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
    expect(resolveXdgConfigHome({ XDG_CONFIG_HOME: "/custom/config" })).toBe(
      resolve("/custom/config"),
    );
  });

  it("falls back to ~/.config on all platforms", () => {
    expect(resolveXdgConfigHome({ HOME: "/tmp/home" })).toBe(
      resolve("/tmp/home", ".config"),
    );
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

describe("expandWindowsEnvVars", () => {
  it("expands %LOCALAPPDATA% variable", () => {
    expect(
      expandWindowsEnvVars("%LOCALAPPDATA%/app/config", {
        LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      }),
    ).toBe("C:\\Users\\test\\AppData\\Local/app/config");
  });

  it("expands multiple variables", () => {
    expect(
      expandWindowsEnvVars("%DRIVE%/%FOLDER%", {
        DRIVE: "C:",
        FOLDER: "Users",
      }),
    ).toBe("C:/Users");
  });

  it("throws when variable is not defined", () => {
    expect(() => expandWindowsEnvVars("%MISSING_VAR%/path", {})).toThrow(
      /%MISSING_VAR%/u,
    );
  });

  it("returns string unchanged when no % tokens present", () => {
    expect(expandWindowsEnvVars("~/.config/app", {})).toBe("~/.config/app");
  });

  it("handles empty %% token without matching", () => {
    expect(expandWindowsEnvVars("%%", {})).toBe("%%");
  });

  it("throws for variable with whitespace-only value", () => {
    expect(() => expandWindowsEnvVars("%VAR%/path", { VAR: "  " })).toThrow(
      /%VAR%/u,
    );
  });
});

describe("expandPlatformConfiguredPath", () => {
  it("expands %LOCALAPPDATA% then resolves", () => {
    expect(
      expandPlatformConfiguredPath("%LOCALAPPDATA%/app", {
        LOCALAPPDATA: "/tmp/appdata",
      }),
    ).toBe("/tmp/appdata/app");
  });

  it("expands ~ paths", () => {
    expect(
      expandPlatformConfiguredPath("~/.config/app", { HOME: "/tmp/home" }),
    ).toBe(resolve("/tmp/home", ".config", "app"));
  });

  it("expands $XDG_CONFIG_HOME paths", () => {
    expect(
      expandPlatformConfiguredPath("$XDG_CONFIG_HOME/app", {
        XDG_CONFIG_HOME: "/custom/config",
      }),
    ).toBe(resolve("/custom/config", "app"));
  });
});

describe("resolvePlatformConfiguredAbsolutePath", () => {
  it("resolves %LOCALAPPDATA% paths", () => {
    expect(
      resolvePlatformConfiguredAbsolutePath("%LOCALAPPDATA%/app", {
        LOCALAPPDATA: "/tmp/appdata",
      }),
    ).toBe(resolve("/tmp/appdata", "app"));
  });

  it("resolves ~ paths", () => {
    expect(
      resolvePlatformConfiguredAbsolutePath("~/.config/app", {
        HOME: "/tmp/home",
      }),
    ).toBe(resolve("/tmp/home", ".config", "app"));
  });

  it("throws for relative paths", () => {
    expect(() =>
      resolvePlatformConfiguredAbsolutePath("relative/path", {}),
    ).toThrow(/must be absolute/u);
  });
});
