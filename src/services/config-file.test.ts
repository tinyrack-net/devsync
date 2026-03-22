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
            machinesExplicit: false,
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
            machinesExplicit: true,
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

  it("omits mode and machines when not explicit", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: "~/.bashrc",
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            machines: [],
            machinesExplicit: false,
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

  it("writes explicit mode even when normal", () => {
    expect(
      createSyncConfigDocument({
        entries: [
          {
            configuredLocalPath: "~/.bashrc",
            kind: "file",
            localPath: "/tmp/home/.bashrc",
            machines: [],
            machinesExplicit: false,
            mode: "normal",
            modeExplicit: true,
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
          mode: "normal",
        },
      ],
      version: 6,
    });
  });
});
