import { describe, expect, it } from "vitest";

import type { ResolvedSyncConfig } from "#app/config/sync.ts";
import { buildEffectiveSyncConfig, type RuntimeAgeConfig } from "./runtime.ts";

const testAge: RuntimeAgeConfig = {
  configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/keys.txt",
  identityFile: "/tmp/keys.txt",
  recipients: ["age1example"],
};

describe("sync runtime", () => {
  it("attaches activeProfile from selection to the effective config", () => {
    const config = {
      entries: [
        {
          configuredMode: { default: "normal" },
          configuredLocalPath: { default: "~/.config/zsh" },
          kind: "directory",
          localPath: "/tmp/home/.config/zsh",
          profiles: ["default", "work"],
          profilesExplicit: true,
          mode: "normal",
          modeExplicit: false,
          permissionExplicit: false,
          repoPath: ".config/zsh",
        },
      ],
      version: 7 as const,
    } satisfies ResolvedSyncConfig;

    const effective = buildEffectiveSyncConfig(
      config,
      {
        profile: "work",
        mode: "single",
      },
      testAge,
    );

    expect(effective.activeProfile).toBe("work");
    expect(effective.age).toEqual(testAge);
    expect(effective.entries).toHaveLength(1);
    expect(effective.entries[0]).toMatchObject({
      mode: "normal",
      repoPath: ".config/zsh",
    });
    expect(effective.entries[0]?.profiles).toEqual(["default", "work"]);
  });

  it("passes through all entries regardless of profile selection", () => {
    const config = {
      entries: [
        {
          configuredMode: { default: "secret" },
          configuredLocalPath: { default: "~/.gitconfig" },
          kind: "file",
          localPath: "/tmp/home/.gitconfig",
          profiles: ["default", "work"],
          profilesExplicit: true,
          mode: "secret",
          modeExplicit: true,
          permissionExplicit: false,
          repoPath: ".gitconfig",
        },
      ],
      version: 7 as const,
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
          profile: "work",
          mode: "single",
        },
        testAge,
      ).entries,
    ).toHaveLength(1);
  });
});
