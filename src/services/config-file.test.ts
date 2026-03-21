import { describe, expect, it } from "vitest";

import { createSyncConfigDocument } from "./config-file.ts";

describe("config-file", () => {
  it("writes v3 directory entries with rules", () => {
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
            machines: {
              "secrets.zsh": ["default", "work"],
            },
            mode: "normal",
            modeExplicit: false,
            name: ".config/zsh",
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
        version: 3,
      }),
    ).toEqual({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
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
    });
  });

  it("writes v3 file entries with mode and machines", () => {
    expect(
      createSyncConfigDocument({
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
        version: 3,
      }),
    ).toEqual({
      age: {
        identityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
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
    });
  });
});
