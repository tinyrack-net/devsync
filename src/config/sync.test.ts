import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import {
  normalizeSyncMachineName,
  parseSyncConfig,
  resolveFileMachine,
  resolveSyncRule,
} from "./sync.ts";

describe("sync config", () => {
  it("allows all alphanumeric machine names", () => {
    expect(normalizeSyncMachineName("work")).toBe("work");
    expect(normalizeSyncMachineName("default")).toBe("default");
    expect(normalizeSyncMachineName("personal")).toBe("personal");
  });

  it("parses v3 directory entries with rules and machines", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        age: {
          identityFile: "~/keys.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            kind: "directory",
            localPath: "~/.config/zsh",
            machines: {
              "secrets.zsh": ["default", "work"],
            },
            rules: {
              "secrets.zsh": "secret",
            },
          },
        ],
        version: 3,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.version).toBe(3);
    expect(config.entries).toHaveLength(1);
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

  it("parses v3 file entries with mode and machines", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    const config = parseSyncConfig(
      {
        age: {
          identityFile: "~/keys.txt",
          recipients: ["age1example"],
        },
        entries: [
          {
            kind: "file",
            localPath: "~/.gitconfig",
            machines: ["default", "work"],
            mode: "secret",
          },
        ],
        version: 3,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.entries).toHaveLength(1);
    expect(config.entries[0]?.machines).toEqual({ "": ["default", "work"] });
    expect(resolveSyncRule(config, ".gitconfig", "work")).toEqual({
      machine: "work",
      mode: "secret",
    });
    expect(resolveSyncRule(config, ".gitconfig")).toEqual({
      machine: "default",
      mode: "secret",
    });
  });

  it("resolves machine fallback to default for unknown machines", () => {
    const machines = { "secrets.zsh": ["default", "work"] };

    expect(resolveFileMachine(machines, "secrets.zsh", "work")).toBe("work");
    expect(resolveFileMachine(machines, "secrets.zsh", "personal")).toBe(
      "default",
    );
    expect(resolveFileMachine(machines, "secrets.zsh", undefined)).toBe(
      "default",
    );
    expect(resolveFileMachine(machines, "other.zsh", "work")).toBe("default");
  });

  it("rejects v2 config format", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          age: {
            identityFile: "~/keys.txt",
            recipients: ["age1example"],
          },
          entries: [],
          version: 2,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });
});
