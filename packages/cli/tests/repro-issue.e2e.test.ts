import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSyncE2EContext,
  type SyncE2EContext,
} from "../src/test/helpers/e2e-context.ts";
import { stripAnsi } from "../src/test/helpers/sync-fixture.ts";

let ctx: SyncE2EContext;

beforeEach(async () => {
  ctx = await createSyncE2EContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe.runIf(process.platform === "win32")(
  "issue always updating directory (Windows case sensitivity)",
  () => {
    it("should not show pull changes when child directory physical casing differs on Windows", async () => {
      const parentDir = join(ctx.homeDir, "parent");
      const childDir = join(parentDir, "SKILLS"); // Physical: SKILLS
      const ageKeys = await ctx.createAgeKeyPair();

      await ctx.writeIdentityFile(ageKeys.identity);
      await mkdir(childDir, { recursive: true });
      await writeFile(join(childDir, "test.txt"), "hello\n");

      await ctx.runCli(["init"]);

      // Track the PARENT directory
      await ctx.runCli(["track", parentDir]);

      // Push
      await ctx.runCli(["push"]);

      // Manually lowercase the repo artifacts to simulate mismatch
      const manifestPath = join(
        ctx.xdgDir,
        "dotweave",
        "repository",
        "manifest.jsonc",
      );
      let manifestContent = await readFile(manifestPath, "utf8");
      manifestContent = manifestContent.replace(/SKILLS/g, "skills");
      await writeFile(manifestPath, manifestContent, "utf8");

      const repoChildDir = join(
        ctx.xdgDir,
        "dotweave",
        "repository",
        "default",
        "parent",
        "SKILLS",
      );
      const repoChildDirLower = join(
        ctx.xdgDir,
        "dotweave",
        "repository",
        "default",
        "parent",
        "skills",
      );
      await rename(repoChildDir, repoChildDirLower);

      // First pull - with the fix, it should say "Already up to date" because it's case-insensitive
      const firstPull = await ctx.runCli(["pull", "-y"]);
      expect(stripAnsi(firstPull.stdout)).toContain("Already up to date");

      // Second pull - should definitely still be "Already up to date"
      const secondPull = await ctx.runCli(["pull", "-y"]);
      expect(stripAnsi(secondPull.stdout)).toContain("Already up to date");
    });

    it("should not show pull changes when symlink target casing differs on Windows", async () => {
      const targetDir = join(ctx.homeDir, "TARGET"); // Physical: TARGET
      const linkPath = join(ctx.homeDir, "link");
      const ageKeys = await ctx.createAgeKeyPair();

      await ctx.writeIdentityFile(ageKeys.identity);
      await mkdir(targetDir, { recursive: true });

      // Create symlink (junction) to TARGET
      await symlink(targetDir, linkPath, "junction");

      await ctx.runCli(["init"]);
      await ctx.runCli(["track", linkPath]);
      await ctx.runCli(["push"]);

      // Manually lowercase the link target in the repo artifact
      const repoLinkPath = join(
        ctx.xdgDir,
        "dotweave",
        "repository",
        "default",
        "link",
      );
      await rename(repoLinkPath, `${repoLinkPath}.tmp`);
      // Use lowercase target path
      const targetDirLower = join(ctx.homeDir, "target");
      await symlink(targetDirLower, repoLinkPath, "junction");

      // First pull - with the fix, it should say "Already up to date" because it's case-insensitive
      const firstPull = await ctx.runCli(["pull", "-y"]);
      expect(stripAnsi(firstPull.stdout)).toContain("Already up to date");

      // Second pull
      const secondPull = await ctx.runCli(["pull", "-y"]);
      expect(stripAnsi(secondPull.stdout)).toContain("Already up to date");
    });
  },
);
