import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSyncE2EContext,
  type SyncE2EContext,
} from "../src/test/helpers/e2e-context.ts";
import { parseManifestEntries } from "../src/test/helpers/mock-factories.ts";
import { stripAnsi } from "../src/test/helpers/sync-fixture.ts";

let ctx: SyncE2EContext;

const readManifestEntries = async () => {
  return parseManifestEntries(
    await readFile(
      join(ctx.xdgDir, "dotweave", "repository", "manifest.jsonc"),
      "utf8",
    ),
  );
};

beforeEach(async () => {
  ctx = await createSyncE2EContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("track CLI manifest e2e", () => {
  it("tracks an existing file with secret mode and permission", async () => {
    const sshDirectory = join(ctx.homeDir, ".ssh");
    const configFile = join(sshDirectory, "config");

    await mkdir(sshDirectory, { recursive: true });
    await writeFile(configFile, "Host example\n  HostName example.com\n");

    await ctx.runCli(["init"]);
    await ctx.runCli([
      "track",
      "~/.ssh/config",
      "--mode",
      "secret",
      "--permission",
      "0600",
    ]);

    const entries = await readManifestEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "file",
      localPath: { default: "~/.ssh/config" },
      mode: { default: "secret" },
      permission: { default: "0600" },
    });
  });

  it("tracks a missing file when kind is explicit", async () => {
    await ctx.runCli(["init"]);
    await ctx.runCli([
      "track",
      "~/.config/future.toml",
      "--kind",
      "file",
      "--mode",
      "normal",
    ]);

    const entries = await readManifestEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "file",
      localPath: { default: "~/.config/future.toml" },
      mode: { default: "normal" },
    });
  });

  it("fails with a hint when tracking a missing target without kind", async () => {
    await ctx.runCli(["init"]);

    const result = await ctx.runCli(["track", "~/.config/future.toml"], {
      reject: false,
    });

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).toContain(
      "Pass --kind file or --kind directory",
    );
  });

  it("writes platform overrides for local path, repo path, and mode", async () => {
    await ctx.runCli(["init"]);
    await ctx.runCli([
      "track",
      "~/.config/tool",
      "--kind",
      "directory",
      "--local",
      "win=%APPDATA%/Tool",
      "--repo",
      ".config/tool",
      "--repo",
      "win=AppData/Roaming/Tool",
      "--mode",
      "normal",
      "--mode",
      "win=ignore",
    ]);

    const entries = await readManifestEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "directory",
      localPath: {
        default: "~/.config/tool",
        win: "%APPDATA%/Tool",
      },
      mode: {
        default: "normal",
        win: "ignore",
      },
      repoPath: {
        default: ".config/tool",
        win: "AppData/Roaming/Tool",
      },
    });
  });

  it("rejects removed --repo-path flag", async () => {
    const result = await ctx.runCli(
      ["track", "~/.gitconfig", "--repo-path", ".gitconfig"],
      { reject: false },
    );

    expect(result.exitCode).not.toBe(0);
    expect(stripAnsi(result.stderr)).toContain(
      "No flag registered for --repo-path",
    );
  });
});
