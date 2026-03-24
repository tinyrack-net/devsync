import { describe, expect, it } from "vitest";

import {
  createSyncConfigDocument,
  sortSyncConfigEntries,
} from "./config-file.js";

describe("config-file", () => {
  it("writes v6 directory entries", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: { default: "~/.config/zsh" },
            kind: "directory",
            localPath: "/tmp/home/.config/zsh",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: false,
            repoPath: ".config/zsh",
          },
        ],
        version: 5,
      }),
    ).toEqual({
      entries: [
        {
          kind: "directory",
          localPath: { default: "~/.config/zsh" },
        },
      ],
      version: 6,
    });
  });

  it("writes v6 file entries with mode and profiles", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: { default: "~/.gitconfig" },
            kind: "file",
            localPath: "/tmp/home/.gitconfig",
            profiles: ["default", "work"],
            profilesExplicit: true,
            mode: "secret",
            modeExplicit: true,
            repoPath: ".gitconfig",
          },
        ],
        version: 5,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.gitconfig" },
          profiles: ["default", "work"],
          mode: "secret",
        },
      ],
      version: 6,
    });
  });

  it("omits mode and profiles when not explicit", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: { default: "~/.bashrc" },
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: false,
            repoPath: ".bashrc",
          },
        ],
        version: 5,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.bashrc" },
        },
      ],
      version: 6,
    });
  });

  it("sorts entries by default path", () => {
    const sorted = sortSyncConfigEntries([
      { kind: "file", localPath: { default: "~/.zshrc" } },
      {
        kind: "directory",
        localPath: { default: "~/.config/app", linux: "$XDG_CONFIG_HOME/app" },
      },
      { kind: "file", localPath: { default: "~/.bashrc" } },
    ]);

    expect(sorted.map((e) => e.localPath)).toEqual([
      { default: "~/.bashrc" },
      { default: "~/.config/app", linux: "$XDG_CONFIG_HOME/app" },
      { default: "~/.zshrc" },
    ]);
  });

  it("writes explicit mode even when normal", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: { default: "~/.bashrc" },
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: true,
            repoPath: ".bashrc",
          },
        ],
        version: 5,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.bashrc" },
          mode: "normal",
        },
      ],
      version: 6,
    });
  });
});
