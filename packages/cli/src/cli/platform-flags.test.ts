import { describe, expect, it } from "vitest";
import {
  parsePlatformModeFlags,
  parsePlatformPermissionFlags,
  parsePlatformStringFlags,
  parsePlatformStringOverrideFlags,
} from "#app/cli/platform-flags.ts";
import { DotweaveError } from "#app/lib/error.ts";

const expectDotweaveErrorCode = (callback: () => unknown, code: string) => {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(DotweaveError);
    expect((error as DotweaveError).code).toBe(code);
    return;
  }

  throw new Error(`Expected DotweaveError with code ${code}`);
};

describe("platform flag parsing", () => {
  describe("parsePlatformStringFlags", () => {
    it("returns undefined when no values are supplied", () => {
      expect(parsePlatformStringFlags("repo", undefined)).toBeUndefined();
    });

    it("parses a bare value as the default platform value", () => {
      expect(parsePlatformStringFlags("repo", ["dotfiles/bashrc"])).toEqual({
        default: "dotfiles/bashrc",
      });
    });

    it("parses default=value as the default platform value", () => {
      expect(
        parsePlatformStringFlags("repo", ["default=dotfiles/bashrc"]),
      ).toEqual({ default: "dotfiles/bashrc" });
    });

    it("parses supported platform overrides with a default", () => {
      expect(
        parsePlatformStringFlags("repo", [
          ".config/app",
          "win=AppData/Roaming/App",
          "mac=Library/Application Support/App",
          "linux=.config/app-linux",
          "wsl=.config/app-wsl",
        ]),
      ).toEqual({
        default: ".config/app",
        linux: ".config/app-linux",
        mac: "Library/Application Support/App",
        win: "AppData/Roaming/App",
        wsl: ".config/app-wsl",
      });
    });

    it("rejects duplicate default values", () => {
      expectDotweaveErrorCode(
        () => parsePlatformStringFlags("repo", ["one", "default=two"]),
        "DUPLICATE_PLATFORM_FLAG",
      );
    });

    it("rejects duplicate platform keys", () => {
      expectDotweaveErrorCode(
        () => parsePlatformStringFlags("repo", ["win=one", "win=two"]),
        "DUPLICATE_PLATFORM_FLAG",
      );
    });

    it("rejects unknown platform keys", () => {
      expectDotweaveErrorCode(
        () => parsePlatformStringFlags("repo", ["freebsd=value"]),
        "INVALID_PLATFORM_FLAG",
      );
    });

    it("rejects empty keys and empty values", () => {
      expectDotweaveErrorCode(
        () => parsePlatformStringFlags("repo", ["=value"]),
        "INVALID_PLATFORM_FLAG",
      );
      expectDotweaveErrorCode(
        () => parsePlatformStringFlags("repo", ["win="]),
        "INVALID_PLATFORM_FLAG",
      );
    });
  });

  describe("parsePlatformStringOverrideFlags", () => {
    it("parses only non-default platform overrides", () => {
      expect(
        parsePlatformStringOverrideFlags("local", [
          "win=%APPDATA%/App",
          "mac=Library/Application Support/App",
        ]),
      ).toEqual({
        mac: "Library/Application Support/App",
        win: "%APPDATA%/App",
      });
    });

    it("rejects bare and default values", () => {
      expectDotweaveErrorCode(
        () => parsePlatformStringOverrideFlags("local", ["~/App"]),
        "INVALID_PLATFORM_FLAG",
      );
      expectDotweaveErrorCode(
        () => parsePlatformStringOverrideFlags("local", ["default=~/App"]),
        "INVALID_PLATFORM_FLAG",
      );
    });
  });

  describe("parsePlatformModeFlags", () => {
    it("parses mode values per platform", () => {
      expect(parsePlatformModeFlags("mode", ["normal", "win=ignore"])).toEqual({
        default: "normal",
        win: "ignore",
      });
    });

    it("rejects unsupported sync modes", () => {
      expectDotweaveErrorCode(
        () => parsePlatformModeFlags("mode", ["normal", "win=archive"]),
        "INVALID_SYNC_MODE",
      );
    });
  });

  describe("parsePlatformPermissionFlags", () => {
    it("parses octal permissions per platform", () => {
      expect(
        parsePlatformPermissionFlags("permission", ["0600", "mac=0400"]),
      ).toEqual({
        default: "0600",
        mac: "0400",
      });
    });

    it("rejects non-octal permission strings", () => {
      expectDotweaveErrorCode(
        () => parsePlatformPermissionFlags("permission", ["600"]),
        "INVALID_PERMISSION",
      );
      expectDotweaveErrorCode(
        () => parsePlatformPermissionFlags("permission", ["win=08ff"]),
        "INVALID_PERMISSION",
      );
    });
  });
});
