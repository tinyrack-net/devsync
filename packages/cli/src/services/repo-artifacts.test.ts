import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONSTANTS } from "#app/config/constants.ts";
import type { ResolvedSyncConfigEntry } from "#app/config/sync-schema.ts";
import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import {
  buildArtifactKey,
  collectArtifactProfiles,
  isRepoArtifactCurrent,
  isSecretArtifactPath,
  parseArtifactRelativePath,
  resolveArtifactRelativePath,
  stripSecretArtifactSuffix,
} from "./repo-artifacts.ts";

const temporaryDirectories: string[] = [];

const createWorkspace = async () => {
  const directory = await createTemporaryDirectory("dotweave-repo-artifacts-");

  temporaryDirectories.push(directory);

  return directory;
};

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (directory !== undefined) {
      await rm(directory, { force: true, recursive: true });
    }
  }
});

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

  it.skipIf(process.platform === "win32")(
    "treats non-executable artifact permission noise as current",
    async () => {
      const workspace = await createWorkspace();
      const artifactDirectory = join(workspace, "default");
      const artifactPath = join(artifactDirectory, "file.txt");

      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(artifactPath, "data\n", "utf8");
      await chmod(artifactPath, 0o600);

      await expect(
        isRepoArtifactCurrent(workspace, {
          category: "plain",
          contents: Buffer.from("data\n"),
          executable: false,
          kind: "file",
          profile: "default",
          repoPath: "file.txt",
        }),
      ).resolves.toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "treats executable artifacts as current when the executable bit matches",
    async () => {
      const workspace = await createWorkspace();
      const artifactDirectory = join(workspace, "default");
      const artifactPath = join(artifactDirectory, "tool");

      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(artifactPath, "#!/bin/sh\n", "utf8");
      await chmod(artifactPath, 0o755);

      await expect(
        isRepoArtifactCurrent(workspace, {
          category: "plain",
          contents: Buffer.from("#!/bin/sh\n"),
          executable: true,
          kind: "file",
          profile: "default",
          repoPath: "tool",
        }),
      ).resolves.toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports executable artifact drift when the executable bit differs",
    async () => {
      const workspace = await createWorkspace();
      const artifactDirectory = join(workspace, "default");
      const artifactPath = join(artifactDirectory, "tool");

      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(artifactPath, "#!/bin/sh\n", "utf8");
      await chmod(artifactPath, 0o644);

      await expect(
        isRepoArtifactCurrent(workspace, {
          category: "plain",
          contents: Buffer.from("#!/bin/sh\n"),
          executable: true,
          kind: "file",
          profile: "default",
          repoPath: "tool",
        }),
      ).resolves.toBe(false);
    },
  );
});
