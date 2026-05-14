import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDirectoryKey,
  doPathsOverlap,
  isExplicitLocalPath,
  isPathEqualOrNested,
  normalizeLinkTarget,
  normalizeLinkTargetWithDependencies,
} from "#app/lib/path.ts";

describe("path helpers", () => {
  it("builds repository directory keys", () => {
    expect(buildDirectoryKey("bundle/cache")).toBe("bundle/cache/");
  });

  it("detects nested and overlapping paths", () => {
    expect(isPathEqualOrNested("/tmp/home/project/file.txt", "/tmp/home")).toBe(
      true,
    );
    expect(isPathEqualOrNested("/tmp/elsewhere", "/tmp/home")).toBe(false);
    expect(doPathsOverlap("/tmp/home/project", "/tmp/home")).toBe(true);
    expect(doPathsOverlap("/tmp/home/one", "/tmp/home/two")).toBe(false);
  });

  it("handles trailing slashes in doPathsOverlap", () => {
    expect(doPathsOverlap("/tmp/home/", "/tmp/home")).toBe(true);
  });

  it("detects equal paths as overlapping in doPathsOverlap", () => {
    expect(doPathsOverlap("/tmp/home", "/tmp/home")).toBe(true);
  });

  it("isExplicitLocalPath returns false for bare filenames", () => {
    expect(isExplicitLocalPath("filename")).toBe(false);
  });

  it("buildDirectoryKey handles already-trailing-slashed paths", () => {
    expect(buildDirectoryKey("dir/")).toBe("dir//");
  });

  it("isPathEqualOrNested returns true for equal paths", () => {
    expect(isPathEqualOrNested("/tmp/home", "/tmp/home")).toBe(true);
  });

  it("recognizes explicit local path inputs", () => {
    expect(isExplicitLocalPath(".")).toBe(true);
    expect(isExplicitLocalPath("~/bundle")).toBe(true);
    expect(isExplicitLocalPath("../bundle")).toBe(true);
    expect(isExplicitLocalPath("bundle/file.txt")).toBe(false);
  });

  describe("normalizeLinkTarget", () => {
    it("returns absolute target as-is on non-windows", () => {
      expect(normalizeLinkTarget("/usr/bin/python3")).toBe("/usr/bin/python3");
    });

    it("resolves relative target against baseDir", () => {
      const expected =
        process.platform === "win32"
          ? resolve("/opt/app/venv", "../bin/python3")
              .replaceAll("\\", "/")
              .toLowerCase()
          : "/opt/app/bin/python3";
      expect(normalizeLinkTarget("../bin/python3", "/opt/app/venv")).toBe(
        expected,
      );
    });

    it("ignores baseDir for absolute target", () => {
      expect(normalizeLinkTarget("/usr/bin/python3", "/opt/app")).toBe(
        "/usr/bin/python3",
      );
    });

    it("returns target unchanged when no baseDir is given", () => {
      expect(normalizeLinkTarget("relative/path")).toBe("relative/path");
    });

    it("resolves dot-slash relative target against baseDir", () => {
      const expected =
        process.platform === "win32"
          ? resolve("/home/user", "./script.sh")
              .replaceAll("\\", "/")
              .toLowerCase()
          : "/home/user/script.sh";
      expect(normalizeLinkTarget("./script.sh", "/home/user")).toBe(expected);
    });

    it("returns resolved targets unchanged for non-windows platforms", () => {
      expect(
        normalizeLinkTargetWithDependencies("../bin/python3", "/opt/app/venv", {
          platform: "linux",
          isAbsolutePath: (path) => path.startsWith("/"),
          resolvePath: (...paths) => paths.join("/").replace("venv/../", ""),
        }),
      ).toBe("/opt/app/bin/python3");
    });

    it("normalizes windows realpath results", () => {
      expect(
        normalizeLinkTargetWithDependencies(
          "C:\\Users\\Me\\File.txt",
          undefined,
          {
            platform: "win32",
            isAbsolutePath: (path) => /^[a-z]:/i.test(path),
            realpathSyncNative: () => "C:\\Users\\ME\\File.txt",
          },
        ),
      ).toBe("c:/users/me/file.txt");
    });

    it("falls back to parent realpath plus basename for missing windows targets with baseDir", () => {
      const realpathSyncNative = (path: string) => {
        if (path === "C:\\Users\\Me\\missing.txt") {
          throw new Error("missing target");
        }

        expect(path).toBe("C:\\Users\\Me");
        return "C:\\USERS\\Me";
      };

      expect(
        normalizeLinkTargetWithDependencies("missing.txt", "C:\\Users\\Me", {
          platform: "win32",
          isAbsolutePath: (path) => /^[a-z]:/i.test(path),
          resolvePath: (...paths) => paths.join("\\"),
          dirnamePath: (path) => path.slice(0, path.lastIndexOf("\\")),
          basenamePath: (path) => path.slice(path.lastIndexOf("\\") + 1),
          joinPath: (...paths) => paths.join("\\"),
          realpathSyncNative,
        }),
      ).toBe("c:/users/me/missing.txt");
    });

    it("resolves windows root-relative targets before normalization", () => {
      expect(
        normalizeLinkTargetWithDependencies("\\Foo\\Bar", undefined, {
          platform: "win32",
          isAbsolutePath: (path) => path.startsWith("\\"),
          resolvePath: (path) => `C:\\Current${path}`,
          realpathSyncNative: () => {
            throw new Error("missing target");
          },
        }),
      ).toBe("c:/current/foo/bar");
    });

    it("does not resolve windows UNC targets as root-relative", () => {
      expect(
        normalizeLinkTargetWithDependencies(
          "\\\\Server\\Share\\File",
          undefined,
          {
            platform: "win32",
            isAbsolutePath: (path) => path.startsWith("\\\\"),
            resolvePath: () => {
              throw new Error(
                "UNC paths should not be resolved as root-relative",
              );
            },
            realpathSyncNative: () => {
              throw new Error("missing target");
            },
          },
        ),
      ).toBe("//server/share/file");
    });

    it("normalizes missing windows targets without baseDir", () => {
      expect(
        normalizeLinkTargetWithDependencies(
          "C:\\Users\\ME\\Missing.txt",
          undefined,
          {
            platform: "win32",
            isAbsolutePath: (path) => /^[a-z]:/i.test(path),
            realpathSyncNative: () => {
              throw new Error("missing target");
            },
          },
        ),
      ).toBe("c:/users/me/missing.txt");
    });
  });
});
