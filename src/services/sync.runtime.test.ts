import { describe, expect, it } from "vitest";

import type { ResolvedSyncConfig } from "#app/config/sync.ts";
import { buildEffectiveSyncConfig } from "./runtime.ts";

describe("sync runtime", () => {
  it("merges base and machine entries into an effective config", () => {
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
          mode: "normal",
          modeExplicit: true,
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
        {
          configuredLocalPath: "~/.config/zsh",
          kind: "directory",
          localPath: "/tmp/home/.config/zsh",
          machine: "work",
          mode: "normal",
          modeExplicit: false,
          name: ".config/zsh#work",
          overrides: [
            {
              match: "exact",
              mode: "secret",
              path: "secrets.zsh",
            },
          ],
          repoPath: ".config/zsh",
        },
      ],
      version: 2 as const,
    } satisfies ResolvedSyncConfig;

    const effective = buildEffectiveSyncConfig(config, {
      machine: "work",
      mode: "single",
    });

    expect(effective.activeMachine).toBe("work");
    expect(effective.entries).toHaveLength(1);
    expect(effective.entries[0]).toMatchObject({
      machineLayer: "work",
      mode: "normal",
      repoPath: ".config/zsh",
    });
    expect(effective.entries[0]?.overrides).toEqual([
      {
        match: "exact",
        mode: "ignore",
        path: "secrets.zsh",
      },
    ]);
    expect(effective.entries[0]?.machineOverrides).toEqual([
      {
        match: "exact",
        mode: "secret",
        path: "secrets.zsh",
      },
    ]);
  });

  it("activates machine-only roots only for the selected machine", () => {
    const config = {
      age: {
        configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        identityFile: "/tmp/keys.txt",
        recipients: ["age1example"],
      },
      entries: [
        {
          configuredLocalPath: "~/.gitconfig-work",
          kind: "file",
          localPath: "/tmp/home/.gitconfig-work",
          machine: "work",
          mode: "secret",
          modeExplicit: true,
          name: ".gitconfig-work#work",
          overrides: [],
          repoPath: ".gitconfig-work",
        },
      ],
      version: 2 as const,
    } satisfies ResolvedSyncConfig;

    expect(
      buildEffectiveSyncConfig(config, {
        mode: "none",
      }).entries,
    ).toHaveLength(0);

    expect(
      buildEffectiveSyncConfig(config, {
        machine: "work",
        mode: "single",
      }).entries,
    ).toHaveLength(1);
  });
});
