import { describe, expect, it } from "vitest";

import { createSyncConfigDocument } from "./config-file.ts";

describe("config-file", () => {
  it("writes v2 base and machine layers", () => {
    expect(
      createSyncConfigDocument({
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
        version: 2,
      }),
    ).toEqual({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
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
    });
  });
});
