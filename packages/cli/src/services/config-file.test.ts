import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";

import {
  buildSyncConfigDocument,
  sortSyncConfigEntries,
  writeValidatedSyncConfig,
} from "./config-file.ts";

describe("config-file", () => {
  it("writes v8 directory entries", () => {
    expect(
      buildSyncConfigDocument({
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
        profiles: [],
        version: 8,
      }),
    ).toEqual({
      entries: [
        {
          kind: "directory",
          localPath: { default: "~/.config/zsh" },
        },
      ],
      profiles: [],
      version: 8,
    });
  });

  it("writes v8 file entries with mode and profiles", () => {
    expect(
      buildSyncConfigDocument({
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
        profiles: ["work"],
        version: 8,
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
      profiles: ["work"],
      version: 8,
    });
  });

  it("omits mode and profiles when not explicit", () => {
    expect(
      buildSyncConfigDocument({
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
        profiles: [],
        version: 8,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.bashrc" },
        },
      ],
      profiles: [],
      version: 8,
    });
  });

  it("writes explicit permissions unchanged", () => {
    expect(
      buildSyncConfigDocument({
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
        profiles: [],
        version: 8,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.ssh/id_rsa" },
          permission: { default: "0600", linux: "0400" },
        },
      ],
      profiles: [],
      version: 8,
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
      buildSyncConfigDocument({
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
        profiles: [],
        version: 8,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.bashrc" },
          mode: { default: "normal" },
        },
      ],
      profiles: [],
      version: 8,
    });
  });

  it("writes explicit platform-aware modes unchanged", () => {
    expect(
      buildSyncConfigDocument({
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
        profiles: [],
        version: 8,
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
      profiles: [],
      version: 8,
    });
  });

  it("writes explicit platform-aware repo paths unchanged", () => {
    expect(
      buildSyncConfigDocument({
        entries: [
          {
            configuredMode: { default: "normal" },
            configuredLocalPath: { default: "~/.gnupg/gpg-agent.conf" },
            configuredRepoPath: {
              default: ".gnupg/gpg-agent.conf",
              linux: ".gnupg/gpg-agent.linux.conf",
              wsl: ".gnupg/gpg-agent.wsl.conf",
            },
            kind: "file",
            localPath: "/tmp/home/.gnupg/gpg-agent.conf",
            profiles: [],
            profilesExplicit: false,
            mode: "normal",
            modeExplicit: false,
            permissionExplicit: false,
            repoPath: ".gnupg/gpg-agent.linux.conf",
          },
        ],
        profiles: [],
        version: 8,
      }),
    ).toEqual({
      entries: [
        {
          kind: "file",
          localPath: { default: "~/.gnupg/gpg-agent.conf" },
          repoPath: {
            default: ".gnupg/gpg-agent.conf",
            linux: ".gnupg/gpg-agent.linux.conf",
            wsl: ".gnupg/gpg-agent.wsl.conf",
          },
        },
      ],
      profiles: [],
      version: 8,
    });
  });

  it("rejects top-level default profile without writing", async () => {
    const syncDirectory = await createTemporaryDirectory(
      "dotweave-config-file-",
    );
    const manifestPath = join(syncDirectory, "manifest.jsonc");

    await expect(
      writeValidatedSyncConfig(syncDirectory, {
        version: 8,
        profiles: ["default"],
        entries: [],
      }),
    ).rejects.toThrowError("default");
    await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
  });

  it("rejects duplicate normalized profile registry values without writing", async () => {
    const syncDirectory = await createTemporaryDirectory(
      "dotweave-config-file-",
    );
    const manifestPath = join(syncDirectory, "manifest.jsonc");

    await expect(
      writeValidatedSyncConfig(syncDirectory, {
        version: 8,
        profiles: ["work", " work "],
        entries: [],
      }),
    ).rejects.toThrowError("Duplicate profile");
    await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
  });

  it("rejects unknown entry profile references without writing", async () => {
    const syncDirectory = await createTemporaryDirectory(
      "dotweave-config-file-",
    );
    const manifestPath = join(syncDirectory, "manifest.jsonc");

    await expect(
      writeValidatedSyncConfig(syncDirectory, {
        version: 8,
        profiles: ["work"],
        entries: [
          {
            kind: "file",
            localPath: { default: "~/.gitconfig" },
            profiles: ["ghost"],
          },
        ],
      }),
    ).rejects.toThrowError("Unknown profile 'ghost'");
    await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
  });
});
