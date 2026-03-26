import { describe, expect, it } from "vitest";

import {
  createSyncConfigDocument,
  sortSyncConfigEntries,
} from "./config-file.js";

describe("config-file", () => {
  it("writes v7 directory entries", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.config/zsh" },
            kind: "directory",
            localPath: "/tmp/home/.config/zsh",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: false,
            permissionExplicit: false,
            repoPath: ".config/zsh",
          },
        ],
        version: 7,
      }),
    ).toEqual({
      entries: [
        {
          kind: "directory",
          localPath: { default: "~/.config/zsh" },
        },
      ],
      version: 7,
    });
  });

  it("writes v7 file entries with mode and profiles", () => {
    expect(
      createSyncConfigDocument({
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
        version: 7,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.gitconfig" },
          profiles: ["default", "work"],
          mode: { default: "secret" },
        },
      ],
      version: 7,
    });
  });

  it("omits mode and profiles when not explicit", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.bashrc" },
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: false,
            permissionExplicit: false,
            repoPath: ".bashrc",
          },
        ],
        version: 7,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.bashrc" },
        },
      ],
      version: 7,
    });
  });

  it("writes explicit permissions unchanged", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.ssh/id_rsa" },
            configuredPermission: { default: "0600", linux: "0400" },
            kind: "file",
            localPath: "/tmp/home/.ssh/id_rsa",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: false,
            permission: 0o600,
            permissionExplicit: true,
            repoPath: ".ssh/id_rsa",
          },
        ],
        version: 7,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.ssh/id_rsa" },
          permission: { default: "0600", linux: "0400" },
        },
      ],
      version: 7,
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
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.bashrc" },
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: true,
            permissionExplicit: false,
            repoPath: ".bashrc",
          },
        ],
        version: 7,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.bashrc" },
          mode: { default: "normal" },
        },
      ],
      version: 7,
    });
  });

  it("writes explicit platform-aware modes unchanged", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredMode: {
              default: "normal",
              linux: "ignore",
              mac: "secret",
              win: "ignore",
              wsl: "secret",
            },
            configuredLocalPath: {
              default: "~/.gitconfig",
              linux: "~/.config/git/config",
              wsl: "~/.config/git/config-wsl",
            },
            kind: "file",
            localPath: "/tmp/home/.gitconfig",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: true,
            permissionExplicit: false,
            repoPath: ".gitconfig",
          },
        ],
        version: 7,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: {
            default: "~/.gitconfig",
            linux: "~/.config/git/config",
            wsl: "~/.config/git/config-wsl",
          },
          mode: {
            default: "normal",
            linux: "ignore",
            mac: "secret",
            win: "ignore",
            wsl: "secret",
          },
        },
      ],
      version: 7,
    });
  });
});
