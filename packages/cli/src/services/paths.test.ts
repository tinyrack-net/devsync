import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("#app/lib/env.ts", () => ({
  ENV: { HOME: "/tmp/home", XDG_CONFIG_HOME: "/tmp/home/.config" },
}));

import type { ResolvedSyncConfigEntry } from "#app/config/sync.ts";
import {
  buildConfiguredHomeLocalPath,
  buildRepoPathWithinRoot,
  resolveTrackedEntry,
  tryBuildRepoPathWithinRoot,
  tryNormalizeRepoPathInput,
} from "#app/services/paths.ts";

const trackedEntry = (
  overrides: Partial<ResolvedSyncConfigEntry> = {},
): ResolvedSyncConfigEntry => ({
  configuredLocalPath: { default: "~/.gitconfig" },
  configuredMode: { default: "normal" },
  kind: "file",
  localPath: "/tmp/home/.gitconfig",
  mode: "normal",
  modeExplicit: false,
  permissionExplicit: false,
  profiles: [],
  profilesExplicit: false,
  repoPath: ".gitconfig",
  ...overrides,
});

describe("path helpers", () => {
  it("builds repository paths within a root", () => {
    expect(
      buildRepoPathWithinRoot(
        resolve("/tmp/home", ".config/tool/settings.json"),
        resolve("/tmp/home"),
        "Sync target",
      ),
    ).toBe(".config/tool/settings.json");
    expect(buildConfiguredHomeLocalPath(".config/tool/settings.json")).toEqual({
      default: "~/.config/tool/settings.json",
    });
  });

  it("rejects root and out-of-root repository paths", () => {
    expect(() => {
      buildRepoPathWithinRoot(
        resolve("/tmp/home"),
        resolve("/tmp/home"),
        "Sync target",
      );
    }).toThrowError(/root directory/u);
    expect(() => {
      buildRepoPathWithinRoot(
        resolve("/tmp/elsewhere"),
        resolve("/tmp/home"),
        "Sync target",
      );
    }).toThrowError(/must stay inside the configured home root/u);
  });

  it("returns undefined from tolerant helpers for invalid inputs", () => {
    expect(
      tryBuildRepoPathWithinRoot(
        resolve("/tmp/elsewhere"),
        resolve("/tmp/home"),
        "Sync target",
      ),
    ).toBeUndefined();
    expect(tryNormalizeRepoPathInput("../bundle")).toBeUndefined();
  });

  it("resolves tracked entries by repository path for non-explicit targets", () => {
    const entry = trackedEntry({
      configuredLocalPath: { default: "~/.config/tool/settings.json" },
      localPath: "/tmp/home/.config/tool/settings.json",
      repoPath: ".config/tool/settings.json",
    });

    expect(
      resolveTrackedEntry(".config/tool/settings.json", [entry], "/tmp/cwd"),
    ).toEqual(entry);
  });

  it("resolves tracked entries by expanded local path", () => {
    const entry = trackedEntry({
      localPath: resolve("/tmp/home", "bundle"),
      repoPath: "bundle",
    });

    expect(resolveTrackedEntry("~/bundle", [entry], "/tmp/cwd")).toEqual(entry);
    expect(resolveTrackedEntry("./bundle", [entry], "/tmp/home")).toEqual(
      entry,
    );
  });

  it("rejects ambiguous tracked entries for the same explicit local path", () => {
    expect(() => {
      resolveTrackedEntry(
        "/tmp/home/.gitconfig",
        [
          trackedEntry({
            localPath: resolve("/tmp/home/.gitconfig"),
            repoPath: ".gitconfig",
          }),
          trackedEntry({
            localPath: resolve("/tmp/home/.gitconfig"),
            repoPath: ".gitconfig-work",
          }),
        ],
        "/tmp/cwd",
      );
    }).toThrowError(/Multiple tracked sync entries match/u);
  });
});
