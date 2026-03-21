import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import {
  normalizeSyncMachineName,
  parseSyncConfig,
  resolveSyncRule,
} from "./sync.ts";

describe("sync config", () => {
  it("rejects the reserved base machine name", () => {
    expect(() => normalizeSyncMachineName("base")).toThrowError(
      "reserved name",
    );
  });

  it("parses base and machine layers", async () => {
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
            base: {
              mode: "normal",
              rules: {
                "secrets.zsh": "ignore",
              },
            },
            kind: "directory",
            localPath: "~/.config/zsh",
            machines: {
              work: {
                rules: {
                  "secrets.zsh": "secret",
                },
              },
            },
            repoPath: ".config/zsh",
          },
        ],
        version: 2,
      },
      {
        HOME: homeDirectory,
      },
    );

    expect(config.version).toBe(2);
    expect(config.entries).toHaveLength(2);
    expect(resolveSyncRule(config, ".config/zsh/secrets.zsh")).toEqual({
      mode: "ignore",
    });
    expect(resolveSyncRule(config, ".config/zsh/secrets.zsh", "work")).toEqual({
      machine: "work",
      mode: "secret",
    });
  });

  it("requires a machine mode when there is no base mode to inherit", async () => {
    const workspace = await createTemporaryDirectory("devsync-sync-config-");
    const homeDirectory = join(workspace, "home");

    expect(() =>
      parseSyncConfig(
        {
          age: {
            identityFile: "~/keys.txt",
            recipients: ["age1example"],
          },
          entries: [
            {
              kind: "file",
              localPath: "~/.gitconfig-work",
              machines: {
                work: {},
              },
              repoPath: ".gitconfig-work",
            },
          ],
          version: 2,
        },
        {
          HOME: homeDirectory,
        },
      ),
    ).toThrowError("Sync configuration is invalid.");
  });
});
