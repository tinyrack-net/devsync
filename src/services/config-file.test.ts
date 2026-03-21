import { describe, expect, it } from "vitest";

import type {
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
  ResolvedSyncOverride,
  SyncConfig,
} from "#app/config/sync.ts";
import {
  countConfiguredRules,
  createSyncConfigDocument,
  createSyncConfigDocumentEntry,
  sortSyncConfigEntries,
} from "#app/services/config-file.ts";

const baseOverride = (
  value: Pick<ResolvedSyncOverride, "match" | "mode" | "path">,
): ResolvedSyncOverride => {
  return value;
};

const baseEntry = (
  value: Pick<
    ResolvedSyncConfigEntry,
    | "configuredLocalPath"
    | "kind"
    | "localPath"
    | "mode"
    | "name"
    | "overrides"
    | "repoPath"
  > & {
    profile?: string;
  },
): ResolvedSyncConfigEntry => {
  return value;
};

describe("config file helpers", () => {
  it("creates default config document entries without empty overrides", () => {
    expect(
      createSyncConfigDocumentEntry(
        baseEntry({
          configuredLocalPath: "~/.zshrc",
          kind: "file",
          localPath: "/tmp/home/.zshrc",
          mode: "normal",
          name: ".zshrc",
          overrides: [],
          repoPath: ".zshrc",
        }),
      ),
    ).toEqual({
      kind: "file",
      localPath: "~/.zshrc",
      mode: "normal",
      repoPath: ".zshrc",
    });
  });

  it("creates sorted override maps for default entries", () => {
    expect(
      createSyncConfigDocumentEntry(
        baseEntry({
          configuredLocalPath: "~/bundle",
          kind: "directory",
          localPath: "/tmp/home/bundle",
          mode: "normal",
          name: "bundle",
          overrides: [
            baseOverride({ match: "exact", mode: "secret", path: "z.txt" }),
            baseOverride({ match: "subtree", mode: "ignore", path: "cache" }),
            baseOverride({ match: "exact", mode: "normal", path: "a.txt" }),
          ],
          repoPath: "bundle",
        }),
      ),
    ).toEqual({
      kind: "directory",
      localPath: "~/bundle",
      mode: "normal",
      overrides: {
        "a.txt": "normal",
        "cache/": "ignore",
        "z.txt": "secret",
      },
      repoPath: "bundle",
    });
  });

  it("creates profile-only config document entries", () => {
    expect(
      createSyncConfigDocumentEntry(
        baseEntry({
          configuredLocalPath: "~/bundle",
          kind: "directory",
          localPath: "/tmp/home/bundle",
          mode: "secret",
          name: "bundle#work",
          overrides: [
            baseOverride({ match: "exact", mode: "ignore", path: "cache.txt" }),
          ],
          profile: "work",
          repoPath: "bundle",
        }),
      ),
    ).toEqual({
      kind: "directory",
      localPath: "~/bundle",
      mode: "secret",
      profiles: {
        work: {
          overrides: {
            "cache.txt": "ignore",
          },
        },
      },
      repoPath: "bundle",
    });
  });

  it("creates and sorts grouped config documents from resolved config", () => {
    const config: ResolvedSyncConfig = {
      version: 1,
      age: {
        configuredIdentityFile: "$XDG_CONFIG_HOME/devsync/age/keys.txt",
        identityFile: "/tmp/xdg/devsync/age/keys.txt",
        recipients: ["age1a", "age1b"],
      },
      entries: [
        baseEntry({
          configuredLocalPath: "~/bundle",
          kind: "directory",
          localPath: "/tmp/home/bundle",
          mode: "secret",
          name: "bundle",
          overrides: [
            baseOverride({ match: "subtree", mode: "ignore", path: "cache" }),
          ],
          repoPath: "bundle",
        }),
        baseEntry({
          configuredLocalPath: "~/bundle",
          kind: "directory",
          localPath: "/tmp/home/bundle",
          mode: "normal",
          name: "bundle#work",
          overrides: [
            baseOverride({ match: "exact", mode: "secret", path: "token.txt" }),
          ],
          profile: "work",
          repoPath: "bundle",
        }),
        baseEntry({
          configuredLocalPath: "~/.zshrc",
          kind: "file",
          localPath: "/tmp/home/.zshrc",
          mode: "normal",
          name: ".zshrc",
          overrides: [],
          repoPath: ".zshrc",
        }),
      ],
    };

    expect(
      sortSyncConfigEntries(createSyncConfigDocument(config).entries),
    ).toEqual([
      {
        kind: "file",
        localPath: "~/.zshrc",
        mode: "normal",
        repoPath: ".zshrc",
      },
      {
        kind: "directory",
        localPath: "~/bundle",
        mode: "secret",
        overrides: { "cache/": "ignore" },
        profiles: {
          work: {
            overrides: { "token.txt": "secret" },
          },
        },
        repoPath: "bundle",
      },
    ] satisfies SyncConfig["entries"]);
    expect(countConfiguredRules(config)).toBe(2);
  });
});
