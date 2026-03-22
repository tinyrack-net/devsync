import { describe, expect, it } from "vitest";

import { createSyncConfigDocument } from "./config-file.ts";

describe("config-file", () => {
  it("writes v6 directory entries", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: "~/.config/zsh",
            kind: "directory",
            localPath: "/tmp/home/.config/zsh",
            machines: [],
            mode: "normal",
            modeExplicit: false,
            name: ".config/zsh",
            repoPath: ".config/zsh",
          },
        ],
        version: 5,
      }),
    ).toEqual({
      entries: [
        {
          kind: "directory",
          localPath: "~/.config/zsh",
        },
      ],
      version: 6,
    });
  });

  it("writes v6 file entries with mode and machines", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: "~/.gitconfig",
            kind: "file",
            localPath: "/tmp/home/.gitconfig",
            machines: ["default", "work"],
            mode: "secret",
            modeExplicit: true,
            name: ".gitconfig",
            repoPath: ".gitconfig",
          },
        ],
        version: 5,
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
      version: 6,
    });
  });

  it("omits mode when normal and machines when empty", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: "~/.bashrc",
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            machines: [],
            mode: "normal",
            modeExplicit: false,
            name: ".bashrc",
            repoPath: ".bashrc",
          },
        ],
        version: 5,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: "~/.bashrc",
        },
      ],
      version: 6,
    });
  });
});
