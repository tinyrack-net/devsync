import { describe, expect, it } from "vitest";

import {
  detectCurrentPlatformKey,
  isWslEnvironment,
  resolveLocalPathForPlatform,
  resolveRepoPathForPlatform,
} from "#app/config/platform.ts";

describe("detectCurrentPlatformKey", () => {
  it("maps win32 to win", () => {
    expect(
      detectCurrentPlatformKey("win32", "10.0.0", undefined, undefined),
    ).toBe("win");
  });

  it("maps darwin to mac", () => {
    expect(
      detectCurrentPlatformKey("darwin", "24.0.0", undefined, undefined),
    ).toBe("mac");
  });

  it("maps linux to linux", () => {
    expect(
      detectCurrentPlatformKey("linux", "6.6.0", undefined, undefined),
    ).toBe("linux");
  });

  it("maps linux with WSL markers to wsl", () => {
    expect(
      detectCurrentPlatformKey(
        "linux",
        "6.6.87.2-microsoft-standard-WSL2",
        undefined,
        undefined,
      ),
    ).toBe("wsl");
  });

  it("maps unknown platforms to linux", () => {
    expect(
      detectCurrentPlatformKey(
        "freebsd" as NodeJS.Platform,
        "14.0.0",
        undefined,
        undefined,
      ),
    ).toBe("linux");
  });
});

describe("isWslEnvironment", () => {
  it("accepts explicit WSL markers", () => {
    expect(isWslEnvironment("6.6.0", "Ubuntu", undefined)).toBe(true);
    expect(isWslEnvironment("6.6.0", undefined, "/run/WSL/1_interop")).toBe(
      true,
    );
  });

  it("detects WSL from os release", () => {
    expect(
      isWslEnvironment(
        "6.6.87.2-microsoft-standard-WSL2",
        undefined,
        undefined,
      ),
    ).toBe(true);
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

describe("resolveRepoPathForPlatform", () => {
  it("returns platform-specific path when available", () => {
    const repoPath = {
      default: ".config/app/config.json",
      linux: ".config/app/config.linux.json",
      mac: "Library/Application Support/app/config.json",
      win: "AppData/Local/app/config.json",
    };

    expect(resolveRepoPathForPlatform(repoPath, "linux")).toBe(
      ".config/app/config.linux.json",
    );
    expect(resolveRepoPathForPlatform(repoPath, "mac")).toBe(
      "Library/Application Support/app/config.json",
    );
    expect(resolveRepoPathForPlatform(repoPath, "win")).toBe(
      "AppData/Local/app/config.json",
    );
  });

  it("prefers wsl and falls back to linux on WSL", () => {
    expect(
      resolveRepoPathForPlatform(
        {
          default: ".gnupg/gpg-agent.conf",
          linux: ".gnupg/gpg-agent.linux.conf",
          wsl: ".gnupg/gpg-agent.wsl.conf",
        },
        "wsl",
      ),
    ).toBe(".gnupg/gpg-agent.wsl.conf");

    expect(
      resolveRepoPathForPlatform(
        {
          default: ".gnupg/gpg-agent.conf",
          linux: ".gnupg/gpg-agent.linux.conf",
        },
        "wsl",
      ),
    ).toBe(".gnupg/gpg-agent.linux.conf");
  });
});
