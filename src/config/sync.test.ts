import { rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isIgnoredSyncPath,
  isSecretSyncPath,
  parseSyncConfig,
  readSyncConfig,
  resolveSyncMode,
  syncSecretArtifactSuffix,
} from "#app/config/sync.ts";
import {
  resolveConfiguredAbsolutePath,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";
import { DevsyncError } from "#app/services/error.ts";
import { createTemporaryDirectory } from "../test/helpers/sync-fixture.ts";

const testHomeDirectory = "/tmp/devsync-home";
const testXdgConfigHome = "/tmp/devsync-xdg";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

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
    ).toBe(testXdgConfigHome);
  });
});

describe("configured path resolution", () => {
  it("expands home-relative path prefixes", () => {
    expect(
      resolveHomeConfiguredAbsolutePath("~/demo", {
        HOME: testHomeDirectory,
      }),
    ).toBe(join(testHomeDirectory, "demo"));
  });

  it("expands supported path prefixes for devsync-owned paths", () => {
    expect(
      resolveConfiguredAbsolutePath("~/demo", {
        HOME: testHomeDirectory,
      }),
    ).toBe(join(testHomeDirectory, "demo"));
    expect(
      resolveConfiguredAbsolutePath("$XDG_CONFIG_HOME/devsync/keys.txt", {
        XDG_CONFIG_HOME: testXdgConfigHome,
      }),
    ).toBe(join(testXdgConfigHome, "devsync", "keys.txt"));
  });
});

describe("parseSyncConfig", () => {
  it("resolves home-scoped entry paths and normalizes overrides", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            kind: "directory",
            localPath: "~/.config/mytool",
            mode: "secret",
            name: ".config/mytool",
            overrides: {
              "cache\\tmp/": "ignore",
              "cache\\tmp\\keep.json": "normal",
            },
            repoPath: ".config\\mytool",
          },
        ],
      },
      {
        HOME: testHomeDirectory,
        XDG_CONFIG_HOME: testXdgConfigHome,
      },
    );

    expect(config.age.identityFile).toBe(
      join(testXdgConfigHome, "devsync", "age", "keys.txt"),
    );
    expect(config.entries).toEqual([
      {
        configuredLocalPath: "~/.config/mytool",
        kind: "directory",
        localPath: join(testHomeDirectory, ".config", "mytool"),
        mode: "secret",
        name: ".config/mytool",
        overrides: [
          {
            match: "subtree",
            mode: "ignore",
            path: "cache/tmp",
          },
          {
            match: "exact",
            mode: "normal",
            path: "cache/tmp/keep.json",
          },
        ],
        repoPath: ".config/mytool",
      },
    ]);
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
            kind: "directory",
            localPath: "/tmp/devsync-home/bundle",
            mode: "normal",
            name: "bundle",
            repoPath: "bundle",
          },
        ],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(config.entries[0]?.localPath).toBe("/tmp/devsync-home/bundle");
    expect(config.entries[0]?.mode).toBe("normal");
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
              kind: "directory",
              localPath: "/tmp/outside-home/bundle",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(/must stay inside HOME/u);
  });

  it("rejects XDG tokens for sync entry local paths", () => {
    expect(() => {
      parseSyncConfig(
        {
          version: 1,
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              kind: "directory",
              localPath: "$XDG_CONFIG_HOME/bundle",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
          XDG_CONFIG_HOME: testXdgConfigHome,
        },
      );
    }).toThrowError(/must be absolute or start with ~/u);
  });

  it("rejects unsupported glob fields", () => {
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
              kind: "directory",
              localPath: "~/bundle",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle",
              secretGlobs: ["**"],
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);
  });

  it("rejects repository paths and overrides that use the reserved secret suffix", () => {
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
              kind: "file",
              localPath: "~/bundle/token.txt",
              mode: "normal",
              name: "bundle/token.txt",
              repoPath: `bundle/token.txt${syncSecretArtifactSuffix}`,
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);

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
              kind: "directory",
              localPath: "~/bundle",
              mode: "normal",
              name: "bundle",
              overrides: {
                [`token.txt${syncSecretArtifactSuffix}`]: "secret",
              },
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);
  });

  it("rejects overrides on file entries", () => {
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
              kind: "file",
              localPath: "~/bundle.json",
              mode: "normal",
              name: "bundle.json",
              overrides: {
                "nested.json": "secret",
              },
              repoPath: "bundle.json",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);
  });

  it("rejects duplicate overrides after normalization", () => {
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
              kind: "directory",
              localPath: "~/bundle",
              mode: "normal",
              name: "bundle",
              overrides: {
                "cache/": "ignore",
                "cache//": "secret",
              },
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);
  });

  it("rejects duplicate entry names and overlapping entry paths", () => {
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
              kind: "file",
              localPath: "~/bundle/one.json",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle/one.json",
            },
            {
              kind: "file",
              localPath: "~/bundle/two.json",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle/two.json",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);

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
              kind: "directory",
              localPath: "~/bundle",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle",
            },
            {
              kind: "file",
              localPath: "~/bundle/file.txt",
              mode: "normal",
              name: "bundle/file.txt",
              repoPath: "bundle/file.txt",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);
  });

  it("rejects the home directory itself and escaping rule paths", () => {
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
              kind: "directory",
              localPath: "~",
              mode: "normal",
              name: "bundle",
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);

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
              kind: "directory",
              localPath: "~/bundle",
              mode: "normal",
              name: "bundle",
              overrides: {
                "../token.txt": "secret",
              },
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(DevsyncError);
  });

  it("resolves modes with exact rules overriding subtree rules and defaults", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "/tmp/identity.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "secret",
            name: "bundle",
            overrides: {
              "private/": "ignore",
              "private/public.json": "normal",
            },
            repoPath: "bundle",
          },
        ],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(resolveSyncMode(config, "bundle/plain.txt")).toBe("secret");
    expect(resolveSyncMode(config, "bundle/private/token.txt")).toBe("ignore");
    expect(resolveSyncMode(config, "bundle/private/public.json")).toBe(
      "normal",
    );
  });

  it("prefers deeper subtree rules and exact matches over same-path subtrees", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "/tmp/identity.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "normal",
            name: "bundle",
            overrides: {
              "private/": "secret",
              "private/public/": "ignore",
              "private/public/file.txt": "normal",
              "private/public/file.txt/": "secret",
            },
            repoPath: "bundle",
          },
        ],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(resolveSyncMode(config, "bundle/private/secret.txt")).toBe("secret");
    expect(resolveSyncMode(config, "bundle/private/public/child.txt")).toBe(
      "ignore",
    );
    expect(resolveSyncMode(config, "bundle/private/public/file.txt")).toBe(
      "normal",
    );
  });

  it("returns undefined for unmanaged paths and exposes helper predicates", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "/tmp/identity.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            kind: "directory",
            localPath: "~/bundle",
            mode: "secret",
            name: "bundle",
            overrides: {
              "ignored.txt": "ignore",
            },
            repoPath: "bundle",
          },
        ],
      },
      {
        HOME: testHomeDirectory,
      },
    );

    expect(resolveSyncMode(config, "elsewhere/file.txt")).toBeUndefined();
    expect(isSecretSyncPath(config, "bundle/token.txt")).toBe(true);
    expect(isIgnoredSyncPath(config, "bundle/ignored.txt")).toBe(true);
    expect(isSecretSyncPath(config, "elsewhere/file.txt")).toBe(false);
    expect(isIgnoredSyncPath(config, "elsewhere/file.txt")).toBe(false);
  });

  it("wraps malformed JSON when reading a sync config file", async () => {
    const syncDirectory = await createTemporaryDirectory(
      "devsync-sync-config-",
    );

    temporaryDirectories.push(syncDirectory);

    await writeFile(join(syncDirectory, "config.json"), "{\n", "utf8");

    await expect(
      readSyncConfig(syncDirectory, {
        HOME: testHomeDirectory,
      }),
    ).rejects.toThrowError(DevsyncError);
  });
});
