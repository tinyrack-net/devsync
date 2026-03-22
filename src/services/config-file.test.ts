import { describe, expect, it } from "vitest";

import { createSyncConfigDocument } from "./config-file.ts";

describe("config-file", () => {
  it("writes v4 directory entries with rules", () => {
    expect(
      createSyncConfigDocument({
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
        version: 4,
      }),
    ).toEqual({
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
      version: 4,
    });
  });

  it("writes v4 file entries with mode and machines", () => {
    expect(
      createSyncConfigDocument({
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
        version: 4,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: "~/.gitconfig",
          machines: ["default", "work"],
          mode: "secret",
        },
      ],
      version: 4,
    });
  });
});
