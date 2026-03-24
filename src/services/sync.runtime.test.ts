import { describe, expect, it } from "vitest";

import type { ResolvedSyncConfig } from "#app/config/sync.js";
import { buildEffectiveSyncConfig, type ResolvedAgeConfig } from "./runtime.js";

const testAge: ResolvedAgeConfig = {
  configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
  identityFile: "/tmp/keys.txt",
  recipients: ["age1example"],
};

describe("sync runtime", () => {
  it("attaches activeMachine from selection to the effective config", () => {
    const config = {
      entries: [
        {
          configuredLocalPath: { default: "~/.config/zsh" },
          kind: "directory",
          localPath: "/tmp/home/.config/zsh",
          machines: ["default", "work"],
          machinesExplicit: true,
          mode: "normal",
          modeExplicit: false,
          name: ".config/zsh",
          repoPath: ".config/zsh",
        },
      ],
      version: 5 as const,
    } satisfies ResolvedSyncConfig;

    const effective = buildEffectiveSyncConfig(
      config,
      {
        machine: "work",
        mode: "single",
      },
      testAge,
    );

    expect(effective.activeMachine).toBe("work");
    expect(effective.age).toEqual(testAge);
    expect(effective.entries).toHaveLength(1);
    expect(effective.entries[0]).toMatchObject({
      mode: "normal",
      repoPath: ".config/zsh",
    });
    expect(effective.entries[0]?.machines).toEqual(["default", "work"]);
  });

  it("passes through all entries regardless of machine selection", () => {
    const config = {
      entries: [
        {
          configuredLocalPath: { default: "~/.gitconfig" },
          kind: "file",
          localPath: "/tmp/home/.gitconfig",
          machines: ["default", "work"],
          machinesExplicit: true,
          mode: "secret",
          modeExplicit: true,
          name: ".gitconfig",
          repoPath: ".gitconfig",
        },
      ],
      version: 5 as const,
    } satisfies ResolvedSyncConfig;

    expect(
      buildEffectiveSyncConfig(
        config,
        {
          mode: "none",
        },
        testAge,
      ).entries,
    ).toHaveLength(1);

    expect(
      buildEffectiveSyncConfig(
        config,
        {
          machine: "work",
          mode: "single",
        },
        testAge,
      ).entries,
    ).toHaveLength(1);
  });
});
