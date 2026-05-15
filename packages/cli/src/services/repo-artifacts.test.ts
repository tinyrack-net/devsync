import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppConstants } from "#app/config/constants.ts";
import type { ResolvedSyncConfigEntry } from "#app/config/sync-schema.ts";
import { createTemporaryDirectory } from "#app/test/helpers/sync-fixture.ts";
import {
  assertNoLegacyProfileArtifactDirectories,
  buildArtifactKey,
  collectArtifactProfiles,
  collectExistingArtifactKeys,
  isRepoArtifactCurrent,
  isSecretArtifactPath,
  parseArtifactRelativePath,
  resolveArtifactRelativePath,
  stripSecretArtifactSuffix,
} from "./repo-artifacts.ts";
import type { EffectiveSyncConfig } from "./sync-context.ts";

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
    expect(profiles.has(AppConstants.SYNC.DEFAULT_PROFILE)).toBe(true);
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

  it("keeps artifact keys logical while resolving physical profiles paths", () => {
    expect(
      buildArtifactKey({
        category: "plain",
        contents: new Uint8Array(),
        executable: false,
        kind: "file",
        profile: "work",
        repoPath: ".gitconfig",
      }),
    ).toBe("work/.gitconfig");

    expect(
      buildArtifactKey({
        category: "plain",
        kind: "directory",
        profile: "work",
        repoPath: ".config/app",
      }),
    ).toBe("work/.config/app/");

    expect(
      buildArtifactKey({
        category: "secret",
        contents: new Uint8Array(),
        executable: false,
        kind: "file",
        profile: "work",
        repoPath: ".ssh/id",
      }),
    ).toBe(`work/.ssh/id${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`);

    expect(
      resolveArtifactRelativePath({
        category: "plain",
        profile: "work",
        repoPath: ".gitconfig",
      }),
    ).toBe("profiles/work/.gitconfig");

    expect(
      resolveArtifactRelativePath({
        category: "secret",
        profile: "work",
        repoPath: ".ssh/id",
      }),
    ).toBe(`profiles/work/.ssh/id${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`);
  });

  it("identifies secret artifact paths", () => {
    expect(
      isSecretArtifactPath(
        `file.txt${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`,
      ),
    ).toBe(true);
    expect(isSecretArtifactPath("file.txt")).toBe(false);
  });

  it("strips secret artifact suffix", () => {
    const path = `file.txt${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`;
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
    ).toBe("profiles/work/config");

    expect(
      resolveArtifactRelativePath({
        category: "secret",
        profile: "work",
        repoPath: "secrets.json",
      }),
    ).toBe(
      `profiles/work/secrets.json${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`,
    );
  });

  it("parses artifact relative paths", () => {
    const relativePath = "profiles/home/.bashrc";
    const parsed = parseArtifactRelativePath(relativePath);
    expect(parsed.profile).toBe("home");
    expect(parsed.repoPath).toBe(".bashrc");
    expect(parsed.secret).toBe(false);

    const secretPath = `profiles/work/token${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`;
    const parsedSecret = parseArtifactRelativePath(secretPath);
    expect(parsedSecret.profile).toBe("work");
    expect(parsedSecret.repoPath).toBe("token");
    expect(parsedSecret.secret).toBe(true);
  });

  it("parses only physical profiles artifact paths", () => {
    expect(parseArtifactRelativePath("profiles/work/.gitconfig")).toEqual({
      profile: "work",
      repoPath: ".gitconfig",
      secret: false,
    });

    expect(
      parseArtifactRelativePath(
        `profiles/work/.ssh/id${AppConstants.SYNC.SECRET_ARTIFACT_SUFFIX}`,
      ),
    ).toEqual({
      profile: "work",
      repoPath: ".ssh/id",
      secret: true,
    });

    expect(() => parseArtifactRelativePath("docs/readme.md")).toThrow();
    expect(() => parseArtifactRelativePath("work/.gitconfig")).toThrow();
  });

  it("collects physical profiles artifacts as logical keys", async () => {
    const workspace = await createWorkspace();
    const config: EffectiveSyncConfig = {
      activeProfile: AppConstants.SYNC.DEFAULT_PROFILE,
      age: { identityFile: "keys.txt", recipients: [] },
      entries: [],
      profiles: [],
      version: AppConstants.SYNC.CONFIG_VERSION,
    };

    await mkdir(join(workspace, "profiles", "work", ".config", "app"), {
      recursive: true,
    });
    await writeFile(join(workspace, "profiles", "work", ".gitconfig"), "data");
    await writeFile(
      join(workspace, "profiles", "work", ".config", "app", "settings.json"),
      "{}\n",
    );
    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "readme.md"), "support docs\n");
    await mkdir(join(workspace, "profiles", ".github"), { recursive: true });
    await writeFile(
      join(workspace, "profiles", ".github", "workflow.yml"),
      "name\n",
    );

    await expect(
      collectExistingArtifactKeys(workspace, config),
    ).resolves.toEqual(
      new Set(["work/.config/app/settings.json", "work/.gitconfig"]),
    );
  });

  it("fails on legacy top-level profile artifact directories but ignores support directories", async () => {
    const workspace = await createWorkspace();

    await mkdir(join(workspace, "docs"), { recursive: true });
    await writeFile(join(workspace, "docs", "readme.md"), "support docs\n");
    await mkdir(join(workspace, ".github", "workflows"), {
      recursive: true,
    });
    await writeFile(
      join(workspace, ".github", "workflows", "ci.yml"),
      "name\n",
    );

    await expect(
      assertNoLegacyProfileArtifactDirectories(
        workspace,
        new Set(["default", "work"]),
      ),
    ).resolves.toBeUndefined();

    await mkdir(join(workspace, "work"), { recursive: true });
    await writeFile(join(workspace, "work", ".gitconfig"), "legacy\n");

    await expect(
      assertNoLegacyProfileArtifactDirectories(
        workspace,
        new Set(["default", "work"]),
      ),
    ).rejects.toMatchObject({ code: "LEGACY_REPOSITORY_LAYOUT" });
  });

  it.skipIf(process.platform === "win32")(
    "treats non-executable artifact permission noise as current",
    async () => {
      const workspace = await createWorkspace();
      const artifactDirectory = join(workspace, "profiles", "default");
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
      const artifactDirectory = join(workspace, "profiles", "default");
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
      const artifactDirectory = join(workspace, "profiles", "default");
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
