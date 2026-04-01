import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import * as platformConfig from "#app/config/platform.ts";
import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import {
  normalizeSyncProfileName,
  parseSyncConfig,
  resolveSyncRule,
} from "./sync.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const forcePlatform = (platformKey: platformConfig.PlatformKey) => {
  vi.spyOn(platformConfig, "detectCurrentPlatformKey").mockReturnValue(
    platformKey,
  );
};

describe("sync config", () => {
  it("allows all alphanumeric profile names", () => {
    expect(normalizeSyncProfileName("work")).toBe("work");
    expect(normalizeSyncProfileName("default")).toBe("default");
    expect(normalizeSyncProfileName("personal")).toBe("personal");
  });

  it("parses v7 entries with flat profiles", async () => {
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
            mode: { default: "secret" },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.version).toBe(7);
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

  it("parses v7 file entries with mode and profiles", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
            profiles: ["default", "work"],
            mode: { default: "secret" },
          },
        ],
        version: 7,
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
            mode: { default: "secret" },
          },
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh/cache" },
            mode: { default: "ignore" },
          },
        ],
        version: 7,
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

  it("rejects v6 config format", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [],
          version: 6,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("rejects the removed legacy age identity path", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");
    const xdgConfigHome = join(workspace, "xdg");

    expect(() =>
      parseSyncConfig(
        {
          age: {
            identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
            recipients: ["age1example"],
          },
          entries: [],
          version: 7,
        },
        {
          HOME: homeDirectory,
          XDG_CONFIG_HOME: xdgConfigHome,
        },
      ),
    ).toThrowError(
      "Configured age identity file uses the removed legacy path.",
    );
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
          version: 7,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("same repository path");
  });

  it("uses explicit repoPath when configured", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.config/tool/settings.json" },
            repoPath: "profiles/shared/tool/settings.json",
          },
        ],
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.repoPath).toBe(
      "profiles/shared/tool/settings.json",
    );
    expect(config.entries[0]?.configuredRepoPath).toBe(
      "profiles/shared/tool/settings.json",
    );
  });

  it("uses explicit platform-aware repoPath when configured", async () => {
    forcePlatform("linux");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gnupg/gpg-agent.conf" },
            repoPath: {
              default: ".gnupg/gpg-agent.conf",
              linux: ".gnupg/gpg-agent.linux.conf",
              wsl: ".gnupg/gpg-agent.wsl.conf",
            },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.repoPath).toBe(".gnupg/gpg-agent.linux.conf");
    expect(config.entries[0]?.configuredRepoPath).toEqual({
      default: ".gnupg/gpg-agent.conf",
      linux: ".gnupg/gpg-agent.linux.conf",
      wsl: ".gnupg/gpg-agent.wsl.conf",
    });
  });

  it("rejects invalid explicit repoPath values", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          version: 7,
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
              repoPath: "../outside",
            },
          ],
        },
        { HOME: homeDirectory },
      ),
    ).toThrowError("Repository path must be a relative POSIX path");

    expect(() =>
      parseSyncConfig(
        {
          version: 7,
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
              repoPath: "/absolute/path",
            },
          ],
        },
        { HOME: homeDirectory },
      ),
    ).toThrowError("Repository path must be a relative POSIX path");
  });

  it("rejects duplicate resolved repo paths from implicit and explicit entries", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          version: 7,
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
            },
            {
              kind: "file",
              localPath: { default: "~/.config/git/config" },
              repoPath: ".gitconfig",
            },
          ],
        },
        { HOME: homeDirectory },
      ),
    ).toThrowError("same repository path");
  });

  it("rejects duplicate resolved repo paths from platform-specific entries on the active platform", async () => {
    forcePlatform("linux");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          version: 7,
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gnupg/gpg-agent.conf" },
              repoPath: {
                default: ".gnupg/gpg-agent.conf",
                linux: ".gnupg/gpg-agent.linux.conf",
              },
            },
            {
              kind: "file",
              localPath: { default: "~/.config/gpg-agent/linux.conf" },
              repoPath: ".gnupg/gpg-agent.linux.conf",
            },
          ],
        },
        { HOME: homeDirectory },
      ),
    ).toThrowError("same repository path");
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
            mode: { default: "secret" },
          },
        ],
        version: 7,
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
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: { default: "secret" },
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
        version: 7,
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
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: { default: "secret" },
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/aliases.zsh" },
            mode: { default: "normal" },
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
    expect(child?.configuredMode).toEqual({ default: "normal" });
  });

  it("inherits the full parent mode policy when child mode is omitted", async () => {
    forcePlatform("win");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: { default: "normal", mac: "secret", win: "ignore" },
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

    expect(child?.configuredMode).toEqual({
      default: "normal",
      mac: "secret",
      win: "ignore",
    });
    expect(child?.mode).toBe("ignore");
  });

  it("does not merge parent platform overrides into explicit child mode", async () => {
    forcePlatform("win");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: { default: "normal", mac: "secret", win: "ignore" },
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/aliases.zsh" },
            mode: { default: "secret" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/aliases.zsh",
    );

    expect(child?.configuredMode).toEqual({ default: "secret" });
    expect(child?.mode).toBe("secret");
  });

  it("transitive inheritance through multiple levels", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config" },
            profiles: ["vivident"],
            mode: { default: "secret" },
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
        version: 7,
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/secrets.zsh" },
          },
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            profiles: ["vivident"],
            mode: { default: "secret" },
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
        version: 7,
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
        version: 7,
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
        version: 7,
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
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]?.repoPath).toBe(".gitconfig");
  });

  it("resolves localPath using linux platform override", async () => {
    forcePlatform("linux");
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
        version: 7,
      },
      {
        HOME: homeDirectory,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    );

    expect(config.entries[0]?.localPath).toBe(join(xdgConfigHome, "app"));
  });

  it("resolves repoPath using linux platform override", async () => {
    forcePlatform("linux");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gnupg/gpg-agent.conf" },
            repoPath: {
              default: ".gnupg/gpg-agent.conf",
              linux: ".gnupg/gpg-agent.linux.conf",
            },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.repoPath).toBe(".gnupg/gpg-agent.linux.conf");
  });

  it("resolves localPath using WSL override before linux", async () => {
    forcePlatform("wsl");
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
              linux: "$XDG_CONFIG_HOME/app-linux",
              wsl: "$XDG_CONFIG_HOME/app-wsl",
            },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    );

    expect(config.entries[0]?.localPath).toBe(join(xdgConfigHome, "app-wsl"));
    expect(config.entries[0]?.configuredLocalPath).toEqual({
      default: "~/.config/app",
      linux: "$XDG_CONFIG_HOME/app-linux",
      wsl: "$XDG_CONFIG_HOME/app-wsl",
    });
  });

  it("falls back to linux localPath on WSL when wsl is omitted", async () => {
    forcePlatform("wsl");
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
        version: 7,
      },
      {
        HOME: homeDirectory,
        XDG_CONFIG_HOME: xdgConfigHome,
      },
    );

    expect(config.entries[0]?.localPath).toBe(join(xdgConfigHome, "app"));
  });

  it("resolves repoPath using WSL override before linux", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gnupg/gpg-agent.conf" },
            repoPath: {
              default: ".gnupg/gpg-agent.conf",
              linux: ".gnupg/gpg-agent.linux.conf",
              wsl: ".gnupg/gpg-agent.wsl.conf",
            },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.repoPath).toBe(".gnupg/gpg-agent.wsl.conf");
  });

  it("falls back to linux repoPath on WSL when wsl is omitted", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gnupg/gpg-agent.conf" },
            repoPath: {
              default: ".gnupg/gpg-agent.conf",
              linux: ".gnupg/gpg-agent.linux.conf",
            },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.repoPath).toBe(".gnupg/gpg-agent.linux.conf");
  });

  it("resolves platform-specific modes for the current OS", async () => {
    forcePlatform("mac");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
            mode: { default: "normal", mac: "secret", win: "ignore" },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.configuredMode).toEqual({
      default: "normal",
      mac: "secret",
      win: "ignore",
    });
    expect(config.entries[0]?.mode).toBe("secret");
  });

  it("resolves WSL-specific mode before linux", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
            mode: {
              default: "normal",
              linux: "ignore",
              wsl: "secret",
            },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.configuredMode).toEqual({
      default: "normal",
      linux: "ignore",
      wsl: "secret",
    });
    expect(config.entries[0]?.mode).toBe("secret");
  });

  it("falls back to linux mode on WSL when wsl is omitted", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
            mode: {
              default: "normal",
              linux: "ignore",
            },
          },
        ],
        version: 7,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries[0]?.mode).toBe("ignore");
  });

  it("inherits WSL mode policy from parent when child mode is omitted", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: {
              default: "normal",
              linux: "ignore",
              wsl: "secret",
            },
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

    expect(child?.configuredMode).toEqual({
      default: "normal",
      linux: "ignore",
      wsl: "secret",
    });
    expect(child?.mode).toBe("secret");
  });

  it("does not merge parent WSL overrides into explicit child mode", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.config/zsh" },
            mode: {
              default: "normal",
              linux: "ignore",
              wsl: "secret",
            },
          },
          {
            kind: "file",
            localPath: { default: "~/.config/zsh/aliases.zsh" },
            mode: { default: "secret" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/aliases.zsh",
    );

    expect(child?.configuredMode).toEqual({ default: "secret" });
    expect(child?.mode).toBe("secret");
  });

  it("rejects string mode format", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
              mode: "secret",
            },
          ],
          version: 7,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
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
          version: 7,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("rejects unknown keys in repoPath object", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
              repoPath: {
                default: ".gitconfig",
                unknownKey: ".gitconfig.work",
              },
            },
          ],
          version: 7,
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
          version: 7,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("rejects repoPath object missing default field", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.gitconfig" },
              repoPath: { linux: ".gitconfig" },
            },
          ],
          version: 7,
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
          version: 7,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("parses entries with permission field", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.ssh/id_rsa" },
            mode: { default: "secret" },
            permission: { default: "0600" },
          },
        ],
        version: 7,
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.permission).toBe(0o600);
    expect(config.entries[0]?.permissionExplicit).toBe(true);
    expect(config.entries[0]?.configuredPermission).toEqual({
      default: "0600",
    });
  });

  it("resolves platform-specific permission", async () => {
    forcePlatform("mac");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.ssh/id_rsa" },
            permission: { default: "0600", mac: "0400" },
          },
        ],
        version: 7,
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.permission).toBe(0o400);
    expect(config.entries[0]?.configuredPermission).toEqual({
      default: "0600",
      mac: "0400",
    });
  });

  it("inherits permission from parent directory entry", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.ssh" },
            permission: { default: "0600" },
          },
          {
            kind: "file",
            localPath: { default: "~/.ssh/config" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find((e) => e.repoPath === ".ssh/config");
    expect(child?.permission).toBe(0o600);
    expect(child?.permissionExplicit).toBe(false);
    expect(child?.configuredPermission).toEqual({ default: "0600" });
  });

  it("child explicit permission overrides parent permission", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.ssh" },
            permission: { default: "0600" },
          },
          {
            kind: "file",
            localPath: { default: "~/.ssh/id_rsa.pub" },
            permission: { default: "0644" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find((e) => e.repoPath === ".ssh/id_rsa.pub");
    expect(child?.permission).toBe(0o644);
    expect(child?.permissionExplicit).toBe(true);
  });

  it("entries without permission have undefined permission", async () => {
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
        version: 7,
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.permission).toBeUndefined();
    expect(config.entries[0]?.permissionExplicit).toBe(false);
    expect(config.entries[0]?.configuredPermission).toBeUndefined();
  });

  it("rejects invalid permission octal strings", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.ssh/id_rsa" },
              permission: { default: "600" },
            },
          ],
          version: 7,
        },
        { HOME: homeDirectory },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });

  it("resolves WSL permission with fallback to linux", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.ssh/id_rsa" },
            permission: { default: "0644", linux: "0600" },
          },
        ],
        version: 7,
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.permission).toBe(0o600);
  });

  it("inherits WSL permission fallback from parent directories", async () => {
    forcePlatform("wsl");
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 7,
        entries: [
          {
            kind: "directory",
            localPath: { default: "~/.ssh" },
            permission: { default: "0644", linux: "0600" },
          },
          {
            kind: "file",
            localPath: { default: "~/.ssh/id_rsa" },
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (entry) => entry.repoPath === ".ssh/id_rsa",
    );
    expect(child?.permission).toBe(0o600);
    expect(child?.permissionExplicit).toBe(false);
    expect(child?.configuredPermission).toEqual({
      default: "0644",
      linux: "0600",
    });
  });

  it("rejects permission objects with unsupported platform keys", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          entries: [
            {
              kind: "file",
              localPath: { default: "~/.ssh/id_rsa" },
              permission: { default: "0600", freebsd: "0600" },
            },
          ],
          version: 7,
        },
        { HOME: homeDirectory },
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
            mode: { default: "secret" },
          },
          {
            kind: "file",
            localPath: { default: "~/.npmrc" },
            profiles: ["default", "work"],
          },
        ],
        version: 7,
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
