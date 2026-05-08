import { afterEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  HOME: undefined as string | undefined,
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
    platform: vi.fn(actual.platform),
    release: vi.fn(actual.release),
  };
});

import { platform, release } from "node:os";
import {
  readEnvValue,
  resolveCurrentPlatformKey,
  resolveDotweaveGlobalConfigFilePathFromEnv,
  resolveDotweaveSyncDirectoryFromEnv,
  resolveHomeDirectoryFromEnv,
  resolveXdgConfigHomeFromEnv,
} from "./runtime-env.ts";

afterEach(() => {
  vi.restoreAllMocks();

  mockEnv.HOME = undefined;
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
      expect(resolveHomeDirectoryFromEnv()).toBe("/home/test");
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
      expect(resolveXdgConfigHomeFromEnv()).toBe("/home/test/.config");
    });

    it("falls back to ~/.config when XDG_CONFIG_HOME is not set", () => {
      mockEnv.HOME = "/home/test";
      expect(resolveXdgConfigHomeFromEnv()).toBe("/home/test/.config");
    });
  });

  describe("resolveDotweaveGlobalConfigFilePathFromEnv", () => {
    it("composes the dotweave global config path", () => {
      mockEnv.HOME = "/home/test";
      mockEnv.XDG_CONFIG_HOME = "/home/test/.config";
      expect(resolveDotweaveGlobalConfigFilePathFromEnv()).toBe(
        "/home/test/.config/dotweave/settings.jsonc",
      );
    });
  });

  describe("resolveDotweaveSyncDirectoryFromEnv", () => {
    it("composes the dotweave sync directory path", () => {
      mockEnv.HOME = "/home/test";
      mockEnv.XDG_CONFIG_HOME = "/home/test/.config";
      expect(resolveDotweaveSyncDirectoryFromEnv()).toBe(
        "/home/test/.config/dotweave/repository",
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
