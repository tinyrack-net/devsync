import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  APPDATA: undefined as string | undefined,
  DOTWEAVE_HOME: undefined as string | undefined,
  HOME: undefined as string | undefined,
  LOCALAPPDATA: undefined as string | undefined,
  USERPROFILE: undefined as string | undefined,
  WSL_DISTRO_NAME: undefined as string | undefined,
  WSL_INTEROP: undefined as string | undefined,
  XDG_CONFIG_HOME: undefined as string | undefined,
}));

vi.mock("#app/lib/env.ts", () => ({
  ENV: mockEnv,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
    platform: vi.fn(actual.platform),
    release: vi.fn(actual.release),
  };
});

import { homedir, platform, release } from "node:os";
import {
  readEnvValue,
  resolveCurrentPlatformKey,
  resolveDotweaveGlobalConfigFilePathFromEnv,
  resolveDotweaveHomeDirectoryFromEnv,
  resolveDotweaveSyncDirectoryFromEnv,
  resolveHomeDirectoryFromEnv,
  resolveXdgConfigHomeFromEnv,
} from "./runtime-env.ts";

afterEach(() => {
  vi.restoreAllMocks();

  mockEnv.APPDATA = undefined;
  mockEnv.DOTWEAVE_HOME = undefined;
  mockEnv.HOME = undefined;
  mockEnv.LOCALAPPDATA = undefined;
  mockEnv.USERPROFILE = undefined;
  mockEnv.WSL_DISTRO_NAME = undefined;
  mockEnv.WSL_INTEROP = undefined;
  mockEnv.XDG_CONFIG_HOME = undefined;
});

describe("runtime-env", () => {
  describe("readEnvValue", () => {
    it("reads and trims environment values", () => {
      mockEnv.HOME = "  /home/user  ";
      expect(readEnvValue("HOME")).toBe("/home/user");
    });

    it("returns undefined for unset environment values", () => {
      expect(readEnvValue("HOME")).toBeUndefined();
    });
  });

  describe("resolveHomeDirectoryFromEnv", () => {
    it("resolves HOME when set", () => {
      mockEnv.HOME = "/home/test";
      expect(resolveHomeDirectoryFromEnv()).toBe(resolve("/home/test"));
    });

    it("falls back to os.homedir when HOME is not set", () => {
      const result = resolveHomeDirectoryFromEnv();
      expect(result).toBeTypeOf("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("resolveXdgConfigHomeFromEnv", () => {
    it("resolves XDG_CONFIG_HOME when set", () => {
      mockEnv.HOME = "/home/test";
      mockEnv.XDG_CONFIG_HOME = "/home/test/.config";
      expect(resolveXdgConfigHomeFromEnv()).toBe(resolve("/home/test/.config"));
    });

    it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
      mockEnv.HOME = "/home/test";
      expect(resolveXdgConfigHomeFromEnv()).toBe(resolve("/home/test/.config"));
    });
  });

  describe("resolveDotweaveHomeDirectoryFromEnv", () => {
    it("uses DOTWEAVE_HOME when set", () => {
      mockEnv.DOTWEAVE_HOME = "/custom/dotweave";
      mockEnv.HOME = "/home/test";
      vi.mocked(platform).mockReturnValue("linux");

      expect(resolveDotweaveHomeDirectoryFromEnv()).toBe(
        resolve("/custom/dotweave"),
      );
    });

    it("uses APPDATA/dotweave by default on Windows", () => {
      mockEnv.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
      mockEnv.HOME = "C:\\Users\\test";
      vi.mocked(platform).mockReturnValue("win32");

      expect(resolveDotweaveHomeDirectoryFromEnv()).toBe(
        resolve("C:\\Users\\test\\AppData\\Roaming", "dotweave"),
      );
    });

    it("falls back to LOCALAPPDATA/dotweave on Windows", () => {
      mockEnv.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
      mockEnv.HOME = "C:\\Users\\test";
      vi.mocked(platform).mockReturnValue("win32");

      expect(resolveDotweaveHomeDirectoryFromEnv()).toBe(
        resolve("C:\\Users\\test\\AppData\\Local", "dotweave"),
      );
    });

    it("falls back to USERPROFILE/AppData/Roaming/dotweave on Windows", () => {
      mockEnv.USERPROFILE = "C:\\Users\\test";
      vi.mocked(platform).mockReturnValue("win32");

      expect(resolveDotweaveHomeDirectoryFromEnv()).toBe(
        resolve("C:\\Users\\test", "AppData", "Roaming", "dotweave"),
      );
    });

    it("falls back to os homedir on Windows instead of HOME", () => {
      mockEnv.HOME = "C:\\msys64\\home\\test";
      vi.mocked(homedir).mockReturnValue("C:\\Users\\test");
      vi.mocked(platform).mockReturnValue("win32");

      expect(resolveDotweaveHomeDirectoryFromEnv()).toBe(
        resolve("C:\\Users\\test", "AppData", "Roaming", "dotweave"),
      );
    });
  });

  describe("resolveDotweaveGlobalConfigFilePathFromEnv", () => {
    it("composes the dotweave global config path", () => {
      mockEnv.HOME = "/home/test";
      mockEnv.XDG_CONFIG_HOME = "/home/test/.config";
      vi.mocked(platform).mockReturnValue("linux");

      expect(resolveDotweaveGlobalConfigFilePathFromEnv()).toBe(
        resolve("/home/test/.config/dotweave/settings.jsonc"),
      );
    });

    it("uses DOTWEAVE_HOME for the global config path", () => {
      mockEnv.DOTWEAVE_HOME = "/custom/dotweave";
      vi.mocked(platform).mockReturnValue("linux");

      expect(resolveDotweaveGlobalConfigFilePathFromEnv()).toBe(
        resolve("/custom/dotweave", "settings.jsonc"),
      );
    });
  });

  describe("resolveDotweaveSyncDirectoryFromEnv", () => {
    it("composes the dotweave sync directory path", () => {
      mockEnv.HOME = "/home/test";
      mockEnv.XDG_CONFIG_HOME = "/home/test/.config";
      vi.mocked(platform).mockReturnValue("linux");

      expect(resolveDotweaveSyncDirectoryFromEnv()).toBe(
        resolve("/home/test/.config/dotweave/repository"),
      );
    });

    it("uses Windows APPDATA for the sync directory by default", () => {
      mockEnv.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
      vi.mocked(platform).mockReturnValue("win32");

      expect(resolveDotweaveSyncDirectoryFromEnv()).toBe(
        resolve("C:\\Users\\test\\AppData\\Roaming", "dotweave", "repository"),
      );
    });
  });

  describe("resolveCurrentPlatformKey", () => {
    it("returns linux on a non-WSL linux environment", () => {
      mockEnv.WSL_DISTRO_NAME = undefined;
      mockEnv.WSL_INTEROP = undefined;
      vi.mocked(platform).mockReturnValue("linux");
      vi.mocked(release).mockReturnValue("6.1.0-generic");
      expect(resolveCurrentPlatformKey()).toBe("linux");
    });

    it("detects WSL when WSL_DISTRO_NAME is set", () => {
      mockEnv.WSL_DISTRO_NAME = "Ubuntu";
      mockEnv.WSL_INTEROP = undefined;
      vi.mocked(platform).mockReturnValue("linux");
      vi.mocked(release).mockReturnValue("5.15.0-microsoft-standard");
      expect(resolveCurrentPlatformKey()).toBe("wsl");
    });

    it("detects WSL when WSL_INTEROP is set", () => {
      mockEnv.WSL_DISTRO_NAME = undefined;
      mockEnv.WSL_INTEROP = "/run/WSL/1_interop";
      vi.mocked(platform).mockReturnValue("linux");
      vi.mocked(release).mockReturnValue("5.15.0-microsoft-standard");
      expect(resolveCurrentPlatformKey()).toBe("wsl");
    });

    it("detects mac platform", () => {
      mockEnv.WSL_DISTRO_NAME = undefined;
      mockEnv.WSL_INTEROP = undefined;
      vi.mocked(platform).mockReturnValue("darwin");
      vi.mocked(release).mockReturnValue("23.0.0");
      expect(resolveCurrentPlatformKey()).toBe("mac");
    });

    it("detects win platform", () => {
      mockEnv.WSL_DISTRO_NAME = undefined;
      mockEnv.WSL_INTEROP = undefined;
      vi.mocked(platform).mockReturnValue("win32");
      vi.mocked(release).mockReturnValue("10.0.19045");
      expect(resolveCurrentPlatformKey()).toBe("win");
    });
  });
});
