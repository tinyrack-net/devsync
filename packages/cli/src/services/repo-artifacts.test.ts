import { describe, expect, it } from "vitest";
import { CONSTANTS } from "#app/config/constants.ts";
import type { ResolvedSyncConfigEntry } from "#app/config/sync-schema.ts";
import {
  buildArtifactKey,
  collectArtifactProfiles,
  isSecretArtifactPath,
  parseArtifactRelativePath,
  resolveArtifactRelativePath,
  stripSecretArtifactSuffix,
} from "./repo-artifacts.ts";

describe("repo-artifacts service", () => {
  it("collects artifact profiles from entries", () => {
    const entries: Pick<ResolvedSyncConfigEntry, "profiles">[] = [
      { profiles: ["profile-a", "profile-b"] },
      { profiles: ["profile-b", "profile-c"] },
    ];
    const profiles = collectArtifactProfiles(entries);
    expect(profiles.has(CONSTANTS.SYNC.DEFAULT_PROFILE)).toBe(true);
    expect(profiles.has("profile-a")).toBe(true);
    expect(profiles.has("profile-b")).toBe(true);
    expect(profiles.has("profile-c")).toBe(true);
    expect(profiles.size).toBe(4);
  });

  it("builds artifact keys correctly", () => {
    expect(
      buildArtifactKey({
        kind: "directory",
        profile: "default",
        repoPath: "config",
        category: "plain",
      }),
    ).toBe("default/config/");

    expect(
      buildArtifactKey({
        kind: "file",
        profile: "default",
        repoPath: "file.txt",
        category: "plain",
        contents: new Uint8Array(),
        executable: false,
      }),
    ).toBe("default/file.txt");
  });

  it("identifies secret artifact paths", () => {
    expect(
      isSecretArtifactPath(`file.txt${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}`),
    ).toBe(true);
    expect(isSecretArtifactPath("file.txt")).toBe(false);
  });

  it("strips secret artifact suffix", () => {
    const path = `file.txt${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}`;
    expect(stripSecretArtifactSuffix(path)).toBe("file.txt");
    expect(stripSecretArtifactSuffix("file.txt")).toBeUndefined();
  });

  it("resolves artifact relative paths", () => {
    expect(
      resolveArtifactRelativePath({
        category: "plain",
        profile: "work",
        repoPath: "config",
      }),
    ).toBe("work/config");

    expect(
      resolveArtifactRelativePath({
        category: "secret",
        profile: "work",
        repoPath: "secrets.json",
      }),
    ).toBe(`work/secrets.json${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}`);
  });

  it("parses artifact relative paths", () => {
    const relativePath = "home/.bashrc";
    const parsed = parseArtifactRelativePath(relativePath);
    expect(parsed.profile).toBe("home");
    expect(parsed.repoPath).toBe(".bashrc");
    expect(parsed.secret).toBe(false);

    const secretPath = `work/token${CONSTANTS.SYNC.SECRET_ARTIFACT_SUFFIX}`;
    const parsedSecret = parseArtifactRelativePath(secretPath);
    expect(parsedSecret.profile).toBe("work");
    expect(parsedSecret.repoPath).toBe("token");
    expect(parsedSecret.secret).toBe(true);
  });
});
