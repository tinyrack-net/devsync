import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.js";
import {
  normalizeSyncMachineName,
  parseSyncConfig,
  resolveSyncRule,
} from "./sync.js";

describe("sync config", () => {
  it("allows all alphanumeric machine names", () => {
    expect(normalizeSyncMachineName("work")).toBe("work");
    expect(normalizeSyncMachineName("default")).toBe("default");
    expect(normalizeSyncMachineName("personal")).toBe("personal");
  });

  it("parses v5 entries with flat machines", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "directory",
            localPath: "~/.config/zsh",
          },
          {
            kind: "file",
            localPath: "~/.config/zsh/secrets.zsh",
            machines: ["default", "work"],
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
      machine: "default",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".config/zsh/secrets.zsh", "work")).toEqual({
      machine: "work",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".config/zsh/other.zsh", "work")).toEqual({
      machine: "default",
      mode: "normal",
    });

    expect(
      resolveSyncRule(config, ".config/zsh/secrets.zsh", "personal"),
    ).toBeUndefined();
  });

  it("parses v5 file entries with mode and machines", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: "~/.gitconfig",
            machines: ["default", "work"],
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
    expect(config.entries[0]?.machines).toEqual(["default", "work"]);
    expect(resolveSyncRule(config, ".gitconfig", "work")).toEqual({
      machine: "work",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".gitconfig")).toEqual({
      machine: "default",
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
            localPath: "~/.config/zsh",
          },
          {
            kind: "file",
            localPath: "~/.config/zsh/secrets.zsh",
            mode: "secret",
          },
          {
            kind: "directory",
            localPath: "~/.config/zsh/cache",
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
            { kind: "file", localPath: "~/.gitconfig" },
            { kind: "file", localPath: "~/.gitconfig" },
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
          { kind: "directory", localPath: "~/.config/zsh" },
          {
            kind: "file",
            localPath: "~/.config/zsh/secrets.zsh",
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
          { kind: "directory", localPath: "~/.config/zsh", mode: "secret" },
          { kind: "file", localPath: "~/.config/zsh/aliases.zsh" },
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

  it("child inherits machines from parent directory", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          {
            kind: "directory",
            localPath: "~/.config/zsh",
            machines: ["vivident", "default"],
          },
          { kind: "file", localPath: "~/.config/zsh/secrets.zsh" },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/secrets.zsh",
    );
    expect(child?.machines).toEqual(["vivident", "default"]);
    expect(child?.machinesExplicit).toBe(false);
  });

  it("explicit child mode overrides parent", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          { kind: "directory", localPath: "~/.config/zsh", mode: "secret" },
          {
            kind: "file",
            localPath: "~/.config/zsh/aliases.zsh",
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
            localPath: "~/.config",
            machines: ["vivident"],
            mode: "secret",
          },
          { kind: "directory", localPath: "~/.config/zsh" },
          { kind: "file", localPath: "~/.config/zsh/secrets.zsh" },
        ],
      },
      { HOME: homeDirectory },
    );

    const mid = config.entries.find((e) => e.repoPath === ".config/zsh");
    const leaf = config.entries.find(
      (e) => e.repoPath === ".config/zsh/secrets.zsh",
    );

    expect(mid?.machines).toEqual(["vivident"]);
    expect(mid?.mode).toBe("secret");
    expect(leaf?.machines).toEqual(["vivident"]);
    expect(leaf?.mode).toBe("secret");
  });

  it("entry order in manifest does not affect inheritance", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [
          { kind: "file", localPath: "~/.config/zsh/secrets.zsh" },
          {
            kind: "directory",
            localPath: "~/.config/zsh",
            machines: ["vivident"],
            mode: "secret",
          },
        ],
      },
      { HOME: homeDirectory },
    );

    const child = config.entries.find(
      (e) => e.repoPath === ".config/zsh/secrets.zsh",
    );
    expect(child?.machines).toEqual(["vivident"]);
    expect(child?.mode).toBe("secret");
  });

  it("root entry with no parent uses defaults", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        version: 5,
        entries: [{ kind: "file", localPath: "~/.gitconfig" }],
      },
      { HOME: homeDirectory },
    );

    expect(config.entries[0]?.machines).toEqual([]);
    expect(config.entries[0]?.mode).toBe("normal");
  });

  it("treats machines as an allowlist", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        entries: [
          {
            kind: "file",
            localPath: "~/.gitconfig",
          },
          {
            kind: "file",
            localPath: "~/.ssh/config",
            machines: ["vivident"],
            mode: "secret",
          },
          {
            kind: "file",
            localPath: "~/.npmrc",
            machines: ["default", "work"],
          },
        ],
        version: 5,
      },
      {
        HOME: homeDirectory,
      },
    );

    // No machines specified → syncs on all machines using default namespace
    expect(resolveSyncRule(config, ".gitconfig")).toEqual({
      machine: "default",
      mode: "normal",
    });
    expect(resolveSyncRule(config, ".gitconfig", "vivident")).toEqual({
      machine: "default",
      mode: "normal",
    });

    // machines: ["vivident"] → only vivident
    expect(resolveSyncRule(config, ".ssh/config", "vivident")).toEqual({
      machine: "vivident",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".ssh/config")).toBeUndefined();
    expect(resolveSyncRule(config, ".ssh/config", "work")).toBeUndefined();

    // machines: ["default", "work"] → default and work only
    expect(resolveSyncRule(config, ".npmrc")).toEqual({
      machine: "default",
      mode: "normal",
    });
    expect(resolveSyncRule(config, ".npmrc", "work")).toEqual({
      machine: "work",
      mode: "normal",
    });
    expect(resolveSyncRule(config, ".npmrc", "vivident")).toBeUndefined();
  });
});
