import { describe, expect, it } from "vitest";

import type { ResolvedSyncConfig } from "#app/config/sync.ts";
import { buildEffectiveSyncConfig } from "./runtime.ts";

describe("sync runtime", () => {
  it("attaches activeMachine from selection to the effective config", () => {
    const config = {
      age: {
        configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        identityFile: "/tmp/keys.txt",
        recipients: ["age1example"],
      },
      entries: [
        {
          configuredLocalPath: "~/.config/zsh",
          kind: "directory",
          localPath: "/tmp/home/.config/zsh",
          machines: {
            "secrets.zsh": ["default", "work"],
          },
          mode: "normal",
          modeExplicit: false,
          name: ".config/zsh",
          overrides: [
            {
              match: "exact",
              mode: "ignore",
              path: "secrets.zsh",
            },
          ],
          repoPath: ".config/zsh",
        },
      ],
      version: 3 as const,
    } satisfies ResolvedSyncConfig;

    const effective = buildEffectiveSyncConfig(config, {
      machine: "work",
      mode: "single",
    });

    expect(effective.activeMachine).toBe("work");
    expect(effective.entries).toHaveLength(1);
    expect(effective.entries[0]).toMatchObject({
      mode: "normal",
      repoPath: ".config/zsh",
    });
    expect(effective.entries[0]?.machines).toEqual({
      "secrets.zsh": ["default", "work"],
    });
  });

  it("passes through all entries regardless of machine selection", () => {
    const config = {
      age: {
        configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        identityFile: "/tmp/keys.txt",
        recipients: ["age1example"],
      },
      entries: [
        {
          configuredLocalPath: "~/.gitconfig",
          kind: "file",
          localPath: "/tmp/home/.gitconfig",
          machines: {
            "": ["default", "work"],
          },
          mode: "secret",
          modeExplicit: true,
          name: ".gitconfig",
          overrides: [],
          repoPath: ".gitconfig",
        },
      ],
      version: 3 as const,
    } satisfies ResolvedSyncConfig;

    expect(
      buildEffectiveSyncConfig(config, {
        mode: "none",
      }).entries,
    ).toHaveLength(1);

    expect(
      buildEffectiveSyncConfig(config, {
        machine: "work",
        mode: "single",
      }).entries,
    ).toHaveLength(1);
  });
});
