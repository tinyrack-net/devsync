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
  SyncConfigError,
} from "#app/config/sync.ts";
import {
  resolveConfiguredAbsolutePath,
  resolveHomeConfiguredAbsolutePath,
  resolveHomeDirectory,
  resolveXdgConfigHome,
} from "#app/config/xdg.ts";
import { createTemporaryDirectory } from "./helpers/sync-fixture.ts";

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
  it("resolves home-scoped entry paths and normalizes rules", () => {
    const config = parseSyncConfig(
      {
        version: 1,
        age: {
          identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            defaultMode: "secret",
            kind: "directory",
            localPath: "~/.config/mytool",
            name: ".config/mytool",
            repoPath: ".config\\mytool",
            rules: [
              {
                match: "subtree",
                mode: "ignore",
                path: "cache\\tmp",
              },
              {
                match: "exact",
                mode: "normal",
                path: "cache\\tmp\\keep.json",
              },
            ],
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
        defaultMode: "secret",
        kind: "directory",
        localPath: join(testHomeDirectory, ".config", "mytool"),
        name: ".config/mytool",
        repoPath: ".config/mytool",
        rules: [
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
    expect(config.entries[0]?.defaultMode).toBe("normal");
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
              name: "bundle",
              repoPath: "bundle",
            },
          ],
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
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              kind: "directory",
              localPath: "$XDG_CONFIG_HOME/bundle",
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
    }).toThrowError(SyncConfigError);
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
    }).toThrowError(SyncConfigError);
  });

  it("rejects child rules on file entries", () => {
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
              name: "bundle.json",
              repoPath: "bundle.json",
              rules: [
                {
                  match: "exact",
                  mode: "secret",
                  path: "nested.json",
                },
              ],
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
  });

  it("rejects duplicate rules for the same path and scope", () => {
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
              name: "bundle",
              repoPath: "bundle",
              rules: [
                {
                  match: "subtree",
                  mode: "ignore",
                  path: "cache",
                },
                {
                  match: "subtree",
                  mode: "secret",
                  path: "cache",
                },
              ],
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
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
              name: "bundle",
              repoPath: "bundle/one.json",
            },
            {
              kind: "file",
              localPath: "~/bundle/two.json",
              name: "bundle",
              repoPath: "bundle/two.json",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);

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
              name: "bundle",
              repoPath: "bundle",
            },
            {
              kind: "file",
              localPath: "~/bundle/file.txt",
              name: "bundle/file.txt",
              repoPath: "bundle/file.txt",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
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
              name: "bundle",
              repoPath: "bundle",
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);

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
              name: "bundle",
              repoPath: "bundle",
              rules: [
                {
                  match: "exact",
                  mode: "secret",
                  path: "../token.txt",
                },
              ],
            },
          ],
        },
        {
          HOME: testHomeDirectory,
        },
      );
    }).toThrowError(SyncConfigError);
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
            defaultMode: "secret",
            kind: "directory",
            localPath: "~/bundle",
            name: "bundle",
            repoPath: "bundle",
            rules: [
              {
                match: "subtree",
                mode: "ignore",
                path: "private",
              },
              {
                match: "exact",
                mode: "normal",
                path: "private/public.json",
              },
            ],
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
            defaultMode: "normal",
            kind: "directory",
            localPath: "~/bundle",
            name: "bundle",
            repoPath: "bundle",
            rules: [
              {
                match: "subtree",
                mode: "secret",
                path: "private",
              },
              {
                match: "subtree",
                mode: "ignore",
                path: "private/public",
              },
              {
                match: "exact",
                mode: "normal",
                path: "private/public/file.txt",
              },
              {
                match: "subtree",
                mode: "secret",
                path: "private/public/file.txt",
              },
            ],
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
            defaultMode: "secret",
            kind: "directory",
            localPath: "~/bundle",
            name: "bundle",
            repoPath: "bundle",
            rules: [
              {
                match: "exact",
                mode: "ignore",
                path: "ignored.txt",
              },
            ],
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
    ).rejects.toThrowError(SyncConfigError);
  });
});
