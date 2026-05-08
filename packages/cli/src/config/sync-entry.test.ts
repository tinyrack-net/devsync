import { describe, expect, it } from "vitest";

import type {
  PlatformSyncMode,
  ResolvedSyncConfig,
  ResolvedSyncConfigEntry,
} from "#app/config/sync-schema.ts";
import {
  buildDefaultPlatformMode,
  collectAllProfileNames,
  collectChildEntryPaths,
  findOwningSyncEntry,
  hasPlatformSpecificModeOverride,
  isIgnoredSyncPath,
  isSecretSyncPath,
  resolveEntryRelativeRepoPath,
  resolveManagedSyncMode,
  resolveSyncMode,
  resolveSyncRule,
} from "./sync-entry.ts";

const makeEntry = (
  repoPath: string,
  kind: "file" | "directory",
  override: Partial<Omit<ResolvedSyncConfigEntry, "repoPath" | "kind">> = {},
): ResolvedSyncConfigEntry => ({
  configuredMode: { default: "normal" },
  configuredLocalPath: { default: `/home/user/${repoPath}` },
  kind,
  localPath: `/home/user/${repoPath}`,
  profiles: [],
  profilesExplicit: false,
  mode: "normal",
  modeExplicit: false,
  permissionExplicit: false,
  repoPath,
  ...override,
});

const makeConfig = (
  entries: ResolvedSyncConfigEntry[],
): ResolvedSyncConfig => ({
  entries,
  version: 7,
});

describe("sync-entry", () => {
  describe("findOwningSyncEntry", () => {
    it("returns undefined for an empty config", () => {
      expect(findOwningSyncEntry(makeConfig([]), "foo")).toBeUndefined();
    });

    it("matches an exact file entry", () => {
      const entry = makeEntry(".bashrc", "file");
      expect(findOwningSyncEntry(makeConfig([entry]), ".bashrc")).toBe(entry);
    });

    it("matches a directory entry by prefix", () => {
      const entry = makeEntry(".config/nvim", "directory");
      expect(
        findOwningSyncEntry(makeConfig([entry]), ".config/nvim/init.lua"),
      ).toBe(entry);
    });

    it("does not match a directory entry for a non-descendant path", () => {
      const entry = makeEntry(".config/nvim", "directory");
      expect(
        findOwningSyncEntry(makeConfig([entry]), ".config/other"),
      ).toBeUndefined();
    });

    it("prefers the longest matching entry (most-specific wins)", () => {
      const parent = makeEntry(".config", "directory");
      const child = makeEntry(".config/nvim", "directory");
      expect(
        findOwningSyncEntry(
          makeConfig([parent, child]),
          ".config/nvim/init.lua",
        ),
      ).toBe(child);
    });

    it("matches a directory entry for its own repo path", () => {
      const entry = makeEntry(".config/nvim", "directory");
      expect(findOwningSyncEntry(makeConfig([entry]), ".config/nvim")).toBe(
        entry,
      );
    });

    it("does not match a file entry for a descendant path", () => {
      const entry = makeEntry(".bashrc", "file");
      expect(
        findOwningSyncEntry(makeConfig([entry]), ".bashrc/extra"),
      ).toBeUndefined();
    });
  });

  describe("collectChildEntryPaths", () => {
    it("collects children of a directory entry", () => {
      const parent = makeEntry(".config", "directory");
      const child = makeEntry(".config/nvim", "file");
      const result = collectChildEntryPaths(
        makeConfig([parent, child]),
        ".config",
      );
      expect(result).toEqual(new Set([".config/nvim"]));
    });

    it("excludes the entry itself", () => {
      const entry = makeEntry(".config", "directory");
      expect(collectChildEntryPaths(makeConfig([entry]), ".config")).toEqual(
        new Set(),
      );
    });

    it("returns empty set for a leaf entry with no children", () => {
      const entry = makeEntry(".bashrc", "file");
      expect(collectChildEntryPaths(makeConfig([entry]), ".bashrc")).toEqual(
        new Set(),
      );
    });
  });

  describe("resolveEntryRelativeRepoPath", () => {
    it("returns empty string for a file entry matching its own repo path", () => {
      const entry = makeEntry(".bashrc", "file");
      expect(resolveEntryRelativeRepoPath(entry, ".bashrc")).toBe("");
    });

    it("returns undefined for a file entry with a non-matching path", () => {
      const entry = makeEntry(".bashrc", "file");
      expect(resolveEntryRelativeRepoPath(entry, ".zshrc")).toBeUndefined();
    });

    it("returns empty string for a directory entry matching its own repo path", () => {
      const entry = makeEntry(".config/nvim", "directory");
      expect(resolveEntryRelativeRepoPath(entry, ".config/nvim")).toBe("");
    });

    it("returns the relative suffix for a nested path inside a directory entry", () => {
      const entry = makeEntry(".config/nvim", "directory");
      expect(resolveEntryRelativeRepoPath(entry, ".config/nvim/init.lua")).toBe(
        "init.lua",
      );
    });

    it("returns undefined for a non-descendant path", () => {
      const entry = makeEntry(".config/nvim", "directory");
      expect(
        resolveEntryRelativeRepoPath(entry, ".config/other"),
      ).toBeUndefined();
    });
  });

  describe("resolveSyncRule", () => {
    it("returns mode and profile for a matched path", () => {
      const entry = makeEntry(".bashrc", "file", {
        mode: "normal",
        profiles: ["default"],
      });
      expect(resolveSyncRule(makeConfig([entry]), ".bashrc")).toEqual({
        mode: "normal",
        profile: "default",
      });
    });

    it("returns undefined for an unmatched path", () => {
      const entry = makeEntry(".bashrc", "file");
      expect(resolveSyncRule(makeConfig([entry]), ".zshrc")).toBeUndefined();
    });

    it("returns undefined when the active profile is not in the entry profiles", () => {
      const entry = makeEntry(".bashrc", "file", {
        profiles: ["work"],
      });
      expect(
        resolveSyncRule(makeConfig([entry]), ".bashrc", "personal"),
      ).toBeUndefined();
    });

    it("uses default profile when no active profile is given and entry has no explicit profiles", () => {
      const entry = makeEntry(".bashrc", "file", {
        profiles: [],
      });
      expect(resolveSyncRule(makeConfig([entry]), ".bashrc")).toEqual({
        mode: "normal",
        profile: "default",
      });
    });
  });

  describe("resolveSyncMode", () => {
    it("returns the mode for a matched path", () => {
      const entry = makeEntry(".bashrc", "file", { mode: "secret" });
      expect(resolveSyncMode(makeConfig([entry]), ".bashrc")).toBe("secret");
    });

    it("returns undefined for an unmatched path", () => {
      expect(resolveSyncMode(makeConfig([]), ".bashrc")).toBeUndefined();
    });
  });

  describe("isIgnoredSyncPath", () => {
    it("returns true for an ignored path", () => {
      const entry = makeEntry(".bashrc", "file", { mode: "ignore" });
      expect(isIgnoredSyncPath(makeConfig([entry]), ".bashrc")).toBe(true);
    });

    it("returns false for a non-ignored path", () => {
      const entry = makeEntry(".bashrc", "file", { mode: "normal" });
      expect(isIgnoredSyncPath(makeConfig([entry]), ".bashrc")).toBe(false);
    });
  });

  describe("isSecretSyncPath", () => {
    it("returns true for a secret path", () => {
      const entry = makeEntry(".bashrc", "file", { mode: "secret" });
      expect(isSecretSyncPath(makeConfig([entry]), ".bashrc")).toBe(true);
    });

    it("returns false for a non-secret path", () => {
      const entry = makeEntry(".bashrc", "file", { mode: "normal" });
      expect(isSecretSyncPath(makeConfig([entry]), ".bashrc")).toBe(false);
    });
  });

  describe("resolveManagedSyncMode", () => {
    it("returns mode for a managed path", () => {
      const entry = makeEntry(".bashrc", "file", { mode: "normal" });
      expect(resolveManagedSyncMode(makeConfig([entry]), ".bashrc")).toBe(
        "normal",
      );
    });

    it("throws DotweaveError with UNMANAGED_SYNC_PATH for an unmanaged path", () => {
      expect(() =>
        resolveManagedSyncMode(makeConfig([]), ".bashrc"),
      ).toThrowErrorMatchingInlineSnapshot(
        `[DotweaveError: Repository path is not managed by the current sync configuration.]`,
      );
    });

    it("includes context in error details when provided", () => {
      try {
        resolveManagedSyncMode(makeConfig([]), ".bashrc", undefined, "push");
      } catch (error) {
        expect(error).toHaveProperty("code", "UNMANAGED_SYNC_PATH");
        const details = (error as { details?: string[] }).details ?? [];
        expect(details.some((d) => d.includes("push"))).toBe(true);
      }
    });
  });

  describe("buildDefaultPlatformMode", () => {
    it("wraps a mode in platform structure with default key", () => {
      expect(buildDefaultPlatformMode("normal")).toEqual<PlatformSyncMode>({
        default: "normal",
      });
    });

    it("wraps secret mode", () => {
      expect(buildDefaultPlatformMode("secret")).toEqual<PlatformSyncMode>({
        default: "secret",
      });
    });
  });

  describe("hasPlatformSpecificModeOverride", () => {
    it("returns false for default-only mode", () => {
      expect(hasPlatformSpecificModeOverride({ default: "normal" })).toBe(
        false,
      );
    });

    it("returns true when win override is set", () => {
      expect(
        hasPlatformSpecificModeOverride({ default: "normal", win: "ignore" }),
      ).toBe(true);
    });

    it("returns true when mac override is set", () => {
      expect(
        hasPlatformSpecificModeOverride({ default: "normal", mac: "secret" }),
      ).toBe(true);
    });

    it("returns true when linux override is set", () => {
      expect(
        hasPlatformSpecificModeOverride({ default: "normal", linux: "normal" }),
      ).toBe(true);
    });

    it("returns true when wsl override is set", () => {
      expect(
        hasPlatformSpecificModeOverride({ default: "normal", wsl: "normal" }),
      ).toBe(true);
    });
  });

  describe("collectAllProfileNames", () => {
    it("deduplicates and sorts profile names", () => {
      const entries = [
        makeEntry("a", "file", { profiles: ["work", "personal"] }),
        makeEntry("b", "file", { profiles: ["personal", "shared"] }),
      ];
      expect(collectAllProfileNames(entries)).toEqual([
        "personal",
        "shared",
        "work",
      ]);
    });

    it("returns empty array for entries with no profiles", () => {
      const entries = [makeEntry("a", "file", { profiles: [] })];
      expect(collectAllProfileNames(entries)).toEqual([]);
    });
  });
});
