import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSyncConfig, SyncConfigError } from "#app/config/sync.ts";
import {
  resolveConfiguredAbsolutePath,
  resolveDevtoolsSyncDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";

describe("resolveXdgConfigHome", () => {
  it("falls back to the default XDG config home", () => {
    expect(resolveXdgConfigHome({})).toBe(join(homedir(), ".config"));
  });

  it("prefers XDG_CONFIG_HOME when set", () => {
    expect(
      resolveXdgConfigHome({
        XDG_CONFIG_HOME: "/tmp/devtools-xdg",
      }),
    ).toBe("/tmp/devtools-xdg");
  });
});

describe("resolveConfiguredAbsolutePath", () => {
  it("expands supported path prefixes", () => {
    expect(resolveConfiguredAbsolutePath("~/demo")).toBe(
      join(homedir(), "demo"),
    );
    expect(
      resolveConfiguredAbsolutePath("$XDG_CONFIG_HOME/devtools/keys.txt", {
        XDG_CONFIG_HOME: "/tmp/devtools-xdg",
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
            name: "bundle",
            kind: "directory",
            localPath: "$XDG_CONFIG_HOME/devtools/local/bundle",
            repoPath: "bundle\\settings",
          },
        ],
        secretGlobs: ["bundle/**/*.json"],
      },
      {
        XDG_CONFIG_HOME: "/tmp/devtools-xdg",
      },
    );

    expect(config.age.identityFile).toBe(
      "/tmp/devtools-xdg/devtools/age/keys.txt",
    );
    expect(config.entries).toEqual([
      {
        configuredLocalPath: "$XDG_CONFIG_HOME/devtools/local/bundle",
        kind: "directory",
        localPath: "/tmp/devtools-xdg/devtools/local/bundle",
        name: "bundle",
        repoPath: "bundle/settings",
      },
    ]);
    expect(config.secretGlobs).toEqual(["bundle/**/*.json"]);
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
              localPath: "/tmp/bundle",
              repoPath: "bundle",
            },
            {
              name: "bundle-file",
              kind: "file",
              localPath: "/tmp/bundle-file",
              repoPath: "bundle/settings.json",
            },
          ],
          secretGlobs: [],
        },
        {},
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
              localPath: "/tmp/local",
              repoPath: "bundle",
            },
            {
              name: "bundle-file",
              kind: "file",
              localPath: "/tmp/local/settings.json",
              repoPath: "settings.json",
            },
          ],
          secretGlobs: [],
        },
        {},
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
