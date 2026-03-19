import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  matchesIgnoreGlob,
  matchesSecretGlob,
  parseSyncConfig,
  SyncConfigError,
} from "#app/config/sync.ts";
import {
  resolveConfiguredAbsolutePath,
  resolveDevtoolsSyncDirectory,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";

const testHomeDirectory = "/tmp/devtools-home";
const testXdgConfigHome = "/tmp/devtools-xdg";

describe("resolveHomeDirectory", () => {
  it("falls back to the operating system home directory", () => {
    expect(resolveHomeDirectory({})).toBe(homedir());
  });

  it("prefers HOME when set", () => {
    expect(
      resolveHomeDirectory({
        HOME: testHomeDirectory,
      }),
    ).toBe(testHomeDirectory);
  });
});

describe("resolveXdgConfigHome", () => {
  it("falls back to the default XDG config home", () => {
    expect(resolveXdgConfigHome({})).toBe(join(homedir(), ".config"));
  });

  it("derives the default XDG config home from HOME", () => {
    expect(
      resolveXdgConfigHome({
        HOME: testHomeDirectory,
      }),
    ).toBe(join(testHomeDirectory, ".config"));
  });

  it("prefers XDG_CONFIG_HOME when set", () => {
    expect(
      resolveXdgConfigHome({
        XDG_CONFIG_HOME: testXdgConfigHome,
      }),
    ).toBe("/tmp/devtools-xdg");
  });
});

describe("resolveHomeConfiguredAbsolutePath", () => {
  it("expands home-relative path prefixes", () => {
    expect(
      resolveHomeConfiguredAbsolutePath("~/demo", {
        HOME: testHomeDirectory,
      }),
    ).toBe(join(testHomeDirectory, "demo"));
  });
});

describe("resolveConfiguredAbsolutePath", () => {
  it("expands supported path prefixes", () => {
    expect(
      resolveConfiguredAbsolutePath("~/demo", {
        HOME: testHomeDirectory,
      }),
    ).toBe(join(testHomeDirectory, "demo"));
    expect(
      resolveConfiguredAbsolutePath("$XDG_CONFIG_HOME/devtools/keys.txt", {
        XDG_CONFIG_HOME: testXdgConfigHome,
      }),
    ).toBe("/tmp/devtools-xdg/devtools/keys.txt");
  });
});

describe("parseSyncConfig", () => {
  it("resolves configured paths and normalizes repo paths", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            name: ".config/mytool",
            kind: "directory",
            ignoreGlobs: ["cache\\*.tmp"],
            localPath: "~/.config/mytool",
            repoPath: ".config\\mytool",
            secretGlobs: ["nested\\*.json"],
          },
        ],
        ignoreGlobs: [".config/mytool\\ignored/**"],
        secretGlobs: [".config/mytool/**/*.json"],
      },
      {
        HOME: testHomeDirectory,
        XDG_CONFIG_HOME: testXdgConfigHome,
      },
    );

    expect(config.age.identityFile).toBe(
      "/tmp/devtools-xdg/devtools/age/keys.txt",
    );
    expect(config.entries).toEqual([
      {
        configuredLocalPath: "~/.config/mytool",
        ignoreGlobs: ["cache/*.tmp"],
        kind: "directory",
        localPath: "/tmp/devtools-home/.config/mytool",
        name: ".config/mytool",
        repoPath: ".config/mytool",
        secretGlobs: ["nested/*.json"],
      },
    ]);
    expect(config.ignoreGlobs).toEqual([".config/mytool/ignored/**"]);
    expect(config.secretGlobs).toEqual([".config/mytool/**/*.json"]);
  });

  it("accepts absolute sync entry paths that stay inside HOME", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "/tmp/identity.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            name: "bundle",
            kind: "directory",
            localPath: "/tmp/devtools-home/bundle",
            repoPath: "bundle",
          },
        ],
        ignoreGlobs: [],
        secretGlobs: [],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(config.entries[0]?.localPath).toBe("/tmp/devtools-home/bundle");
  });

  it("rejects sync entry local paths outside HOME", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "/tmp/identity.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              name: "bundle",
              kind: "directory",
              localPath: "/tmp/outside-home/bundle",
              repoPath: "bundle",
            },
          ],
          ignoreGlobs: [],
          secretGlobs: [],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("rejects XDG tokens for sync entry local paths", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devtools/age/keys.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              name: "bundle",
              kind: "directory",
              localPath: "$XDG_CONFIG_HOME/bundle",
              repoPath: "bundle",
            },
          ],
          ignoreGlobs: [],
          secretGlobs: [],
        },
        {
          HOME: testHomeDirectory,
          XDG_CONFIG_HOME: testXdgConfigHome,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("matches global and entry-level secret globs", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "/tmp/identity.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            name: "bundle",
            kind: "directory",
            localPath: "/tmp/devtools-home/bundle",
            repoPath: "bundle",
            secretGlobs: ["nested/*.json"],
          },
          {
            name: "settings",
            kind: "file",
            localPath: "/tmp/devtools-home/settings.json",
            repoPath: "settings.json",
            secretGlobs: ["*"],
          },
        ],
        ignoreGlobs: [],
        secretGlobs: ["bundle/global.json"],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(matchesSecretGlob(config, "bundle/global.json")).toBe(true);
    expect(matchesSecretGlob(config, "bundle/nested/token.json")).toBe(true);
    expect(matchesSecretGlob(config, "settings.json")).toBe(true);
    expect(matchesSecretGlob(config, "bundle/plain.txt")).toBe(false);
  });

  it("matches global and entry-level ignore globs and lets ignore win", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "/tmp/identity.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            name: "bundle",
            kind: "directory",
            ignoreGlobs: ["ignored/*.json"],
            localPath: "/tmp/devtools-home/bundle",
            repoPath: "bundle",
            secretGlobs: ["ignored/*.json", "nested/*.json"],
          },
          {
            name: "settings",
            kind: "file",
            ignoreGlobs: ["*"],
            localPath: "/tmp/devtools-home/settings.json",
            repoPath: "settings.json",
            secretGlobs: ["*"],
          },
        ],
        ignoreGlobs: ["bundle/global-ignore.json"],
        secretGlobs: ["bundle/global-secret.json"],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(matchesIgnoreGlob(config, "bundle/global-ignore.json")).toBe(true);
    expect(matchesIgnoreGlob(config, "bundle/ignored/token.json")).toBe(true);
    expect(matchesIgnoreGlob(config, "settings.json")).toBe(true);
    expect(matchesSecretGlob(config, "bundle/global-secret.json")).toBe(true);
    expect(matchesSecretGlob(config, "bundle/ignored/token.json")).toBe(false);
    expect(matchesSecretGlob(config, "settings.json")).toBe(false);
  });

  it("rejects overlapping repository paths", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "/tmp/identity.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              name: "bundle",
              kind: "directory",
              localPath: "/tmp/devtools-home/bundle",
              repoPath: "bundle",
            },
            {
              name: "bundle-file",
              kind: "file",
              localPath: "/tmp/devtools-home/bundle-file",
              repoPath: "bundle/settings.json",
            },
          ],
          ignoreGlobs: [],
          secretGlobs: [],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("rejects overlapping local paths", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "/tmp/identity.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              name: "bundle",
              kind: "directory",
              localPath: "/tmp/devtools-home/local",
              repoPath: "bundle",
            },
            {
              name: "bundle-file",
              kind: "file",
              localPath: "/tmp/devtools-home/local/settings.json",
              repoPath: "settings.json",
            },
          ],
          ignoreGlobs: [],
          secretGlobs: [],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("rejects entry secret globs that escape the entry root", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "/tmp/identity.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              name: "bundle",
              kind: "directory",
              localPath: "/tmp/devtools-home/bundle",
              repoPath: "bundle",
              secretGlobs: ["../secret.json"],
            },
          ],
          ignoreGlobs: [],
          secretGlobs: [],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("rejects entry ignore globs that escape the entry root", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "/tmp/identity.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              name: "bundle",
              kind: "directory",
              ignoreGlobs: ["../ignored.json"],
              localPath: "/tmp/devtools-home/bundle",
              repoPath: "bundle",
            },
          ],
          ignoreGlobs: [],
          secretGlobs: [],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("resolves the default sync directory from XDG", () => {
    expect(
      resolveDevtoolsSyncDirectory({
        XDG_CONFIG_HOME: "/tmp/devtools-xdg",
      }),
    ).toBe("/tmp/devtools-xdg/devtools/sync");
  });
});
