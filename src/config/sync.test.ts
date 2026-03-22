import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import {
  normalizeSyncMachineName,
  parseSyncConfig,
  resolveSyncRule,
} from "./sync.ts";

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
});
