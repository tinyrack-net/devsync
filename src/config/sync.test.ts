import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.js";
import {
  normalizeSyncProfileName,
  parseSyncConfig,
  resolveSyncRule,
} from "./sync.js";

describe("sync config", () => {
  it("allows all alphanumeric profile names", () => {
    expect(normalizeSyncProfileName("work")).toBe("work");
    expect(normalizeSyncProfileName("default")).toBe("default");
    expect(normalizeSyncProfileName("personal")).toBe("personal");
  });

  it("parses v5 entries with flat profiles", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
            profiles: ["default", "work"],
            mode: "secret",
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.version).toBe(5);
    expect(config.entries).toHaveLength(2);
    expect(resolveSyncRule(config, ".config/zsh/secrets.zsh")).toEqual({
      profile: "default",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".config/zsh/secrets.zsh", "work")).toEqual({
      profile: "work",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".config/zsh/other.zsh", "work")).toEqual({
      profile: "default",
      mode: "normal",
    });

    expect(
      resolveSyncRule(config, ".config/zsh/secrets.zsh", "personal"),
    ).toBeUndefined();
  });

  it("parses v5 file entries with mode and profiles", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
            profiles: ["default", "work"],
            mode: "secret",
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]?.profiles).toEqual(["default", "work"]);
    expect(resolveSyncRule(config, ".gitconfig", "work")).toEqual({
      profile: "work",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".gitconfig")).toEqual({
      profile: "default",
      mode: "secret",
    });
  });

  it("finds the most specific entry for nested paths", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
            mode: "secret",
          },
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh/cache" },
            mode: "ignore",
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(resolveSyncRule(config, ".config/zsh/secrets.zsh")?.mode).toBe(
      "secret",
    );
    expect(resolveSyncRule(config, ".config/zsh/cache/state.txt")?.mode).toBe(
      "ignore",
    );
    expect(resolveSyncRule(config, ".config/zsh/other.zsh")?.mode).toBe(
      "normal",
    );
  });

  it("rejects v4 config format", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [],
          version: 4,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("rejects duplicate repo paths", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            { kind: "file", localPath: { default: "~/.gitconfig" } },
            { kind: "file", localPath: { default: "~/.gitconfig" } },
          ],
          version: 5,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Duplicate");
  });

  it("allows parent-child path overlaps", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          { kind: "directory", localPath: { default: "~/.config/zsh" } },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
            mode: "secret",
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries).toHaveLength(2);
  });

  it("child inherits mode from parent directory", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: "secret",
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/aliases.zsh" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/aliases.zsh",
    );
    expect(child?.mode).toBe("secret");
    expect(child?.modeExplicit).toBe(false);
  });

  it("child inherits profiles from parent directory", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            profiles: ["vivident", "default"],
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/secrets.zsh",
    );
    expect(child?.profiles).toEqual(["vivident", "default"]);
    expect(child?.profilesExplicit).toBe(false);
  });

  it("explicit child mode overrides parent", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: "secret",
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/aliases.zsh" },
            mode: "normal",
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/aliases.zsh",
    );
    expect(child?.mode).toBe("normal");
    expect(child?.modeExplicit).toBe(true);
  });

  it("transitive inheritance through multiple levels", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config" },
            profiles: ["vivident"],
            mode: "secret",
          },
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const mid = config.entries.find((e) => e.repoPath === ".config/zsh");
    const leaf = config.entries.find(
      (e) => e.repoPath === ".config/zsh/secrets.zsh",
    );

    expect(mid?.profiles).toEqual(["vivident"]);
    expect(mid?.mode).toBe("secret");
    expect(leaf?.profiles).toEqual(["vivident"]);
    expect(leaf?.mode).toBe("secret");
  });

  it("entry order in manifest does not affect inheritance", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
          },
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            profiles: ["vivident"],
            mode: "secret",
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/secrets.zsh",
    );
    expect(child?.profiles).toEqual(["vivident"]);
    expect(child?.mode).toBe("secret");
  });

  it("root entry with no parent uses defaults", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.profiles).toEqual([]);
    expect(config.entries[0]?.mode).toBe("normal");
  });

  it("parses entries with object localPath format", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "directory",
            localPath: {
              default: "~/.config/app",
              linux: "$XDG_CONFIG_HOME/app",
            },
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
        XDG_CONFIG_HOME: join(homeDirectory, ".config"),
      },
    );

    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]?.repoPath).toBe(".config/app");
    expect(config.entries[0]?.configuredLocalPath).toEqual({
      default: "~/.config/app",
      linux: "$XDG_CONFIG_HOME/app",
    });
  });

  it("derives repoPath from default path regardless of platform overrides", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: {
              default: "~/.config/tool/settings.json",
              mac: "~/Library/Application Support/tool/settings.json",
            },
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.repoPath).toBe(".config/tool/settings.json");
  });

  it("parses entries with default-only object localPath", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]?.repoPath).toBe(".gitconfig");
  });

  it("resolves localPath using linux platform override", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(homeDirectory, ".config");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "directory",
            localPath: {
              default: "~/.config/app",
              linux: "$XDG_CONFIG_HOME/app",
            },
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    );

    expect(config.entries[0]?.localPath).toBe(join(xdgConfigHome, "app"));
  });

  it("rejects unknown keys in localPath object", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: {
                default: "~/.gitconfig",
                unknownKey: "value",
              },
            },
          ],
          version: 5,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("rejects localPath object missing default field", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: { linux: "~/.gitconfig" },
            },
          ],
          version: 5,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("rejects string localPath format", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [{ kind: "file", localPath: "~/.gitconfig" }],
          version: 5,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("treats profiles as an allowlist", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
          },
          {
            kind: "file",
            localPath: { default: "~/.ssh/config" },
            profiles: ["vivident"],
            mode: "secret",
          },
          {
            kind: "file",
            localPath: { default: "~/.npmrc" },
            profiles: ["default", "work"],
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    // No profiles specified → syncs on all profiles using default namespace
    expect(resolveSyncRule(config, ".gitconfig")).toEqual({
      profile: "default",
      mode: "normal",
    });
    expect(resolveSyncRule(config, ".gitconfig", "vivident")).toEqual({
      profile: "default",
      mode: "normal",
    });

    // profiles: ["vivident"] → only vivident
    expect(resolveSyncRule(config, ".ssh/config", "vivident")).toEqual({
      profile: "vivident",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".ssh/config")).toBeUndefined();
    expect(resolveSyncRule(config, ".ssh/config", "work")).toBeUndefined();

    // profiles: ["default", "work"] → default and work only
    expect(resolveSyncRule(config, ".npmrc")).toEqual({
      profile: "default",
      mode: "normal",
    });
    expect(resolveSyncRule(config, ".npmrc", "work")).toEqual({
      profile: "work",
      mode: "normal",
    });
    expect(resolveSyncRule(config, ".npmrc", "vivident")).toBeUndefined();
  });
});
