import { mkdir, readFile, writeFile } from "node:fs/promises";
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

describe("profile CLI e2e", () => {
  it("lists the active profile and available profiles after init", async () => {
    const ageKeys = await ctx.createAgeKeyPair();
    await ctx.writeIdentityFile(ageKeys.identity);
    await ctx.runCli(["init"]);

    const result = await ctx.runCli(["profile", "list"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Profiles");
    expect(out).toContain("active: default");
  });

  it("sets and reads back the active profile via profile use", async () => {
    const ageKeys = await ctx.createAgeKeyPair();
    await ctx.writeIdentityFile(ageKeys.identity);
    await ctx.runCli(["init"]);

    const setResult = await ctx.runCli(["profile", "use", "work"]);

    expect(setResult.exitCode).toBe(0);
    expect(stripAnsi(setResult.stdout)).toContain("Active profile set to work");

    const settings = JSON.parse(
      await readFile(join(ctx.xdgDir, "dotweave", "settings.jsonc"), "utf8"),
    ) as { activeProfile: string };

    expect(settings.activeProfile).toBe("work");
  });

  it("clears the active profile when profile use is called without a name", async () => {
    const ageKeys = await ctx.createAgeKeyPair();
    await ctx.writeIdentityFile(ageKeys.identity);
    await ctx.runCli(["init"]);
    await ctx.runCli(["profile", "use", "work"]);

    const clearResult = await ctx.runCli(["profile", "use"]);

    expect(clearResult.exitCode).toBe(0);
    expect(stripAnsi(clearResult.stdout)).toContain("Active profile cleared");

    const settings = JSON.parse(
      await readFile(join(ctx.xdgDir, "dotweave", "settings.jsonc"), "utf8"),
    ) as { activeProfile?: string };

    expect(settings.activeProfile).toBeUndefined();
  });

  it("lists profile assignments after tracking entries with --profile", async () => {
    const configDir = join(ctx.homeDir, ".config", "workapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "token = secret\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir, "--profile", "work"]);

    const result = await ctx.runCli(["profile", "list", "--verbose"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("1 restricted entries");
    expect(out).toContain("assignments:");
    expect(out).toContain("work");
  });

  it("pushes and pulls only profile-scoped entries with --profile flag", async () => {
    const workDir = join(ctx.homeDir, ".config", "work");
    const homeDir2 = join(ctx.homeDir, ".config", "personal");
    const workFile = join(workDir, "work.conf");
    const personalFile = join(homeDir2, "personal.conf");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(workDir, { recursive: true });
    await mkdir(homeDir2, { recursive: true });
    await writeFile(workFile, "office = true\n");
    await writeFile(personalFile, "home = true\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", workDir, "--profile", "work"]);
    await ctx.runCli(["track", homeDir2, "--profile", "home"]);

    // Push only the work profile
    const pushResult = await ctx.runCli(["push", "--profile", "work"]);

    expect(pushResult.exitCode).toBe(0);
    expect(stripAnsi(pushResult.stdout)).toContain("Push complete");

    // Work artifact should exist in the repository
    const workArtifact = join(
      ctx.xdgDir,
      "dotweave",
      "repository",
      "work",
      ".config",
      "work",
      "work.conf",
    );
    expect(await readFile(workArtifact, "utf8")).toContain("office = true");

    // Personal artifact should NOT have been pushed
    const personalArtifact = join(
      ctx.xdgDir,
      "dotweave",
      "repository",
      "home",
      ".config",
      "personal",
      "personal.conf",
    );
    await expect(readFile(personalArtifact, "utf8")).rejects.toThrow();
  }, 15_000);
});
