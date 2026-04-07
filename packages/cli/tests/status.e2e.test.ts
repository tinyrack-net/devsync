import { mkdir, writeFile } from "node:fs/promises";
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

describe("status CLI e2e", () => {
  it("reports zero pending changes after init with no tracked entries", async () => {
    const ageKeys = await ctx.createAgeKeyPair();
    await ctx.writeIdentityFile(ageKeys.identity);
    await ctx.runCli(["init"]);

    const result = await ctx.runCli(["status"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Sync status");
    expect(out).toContain("0 entries");
    expect(out).toContain("Push changes");
    expect(out).toContain("No push changes");
    expect(out).toContain("Pull changes");
    expect(out).toContain("No pull changes");
  });

  it("reports files pending push after track and before push", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = value\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);

    const result = await ctx.runCli(["status"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Sync status");
    expect(out).toContain("1 entries");
    // Files to push to repository
    expect(out).toContain("Push changes");
    expect(out).toContain("Add");
    // Pull would remove local files that don't exist in repo yet
    expect(out).toContain("Pull changes");
    expect(out).toContain("Remove");
  });

  it("reports files pending pull after push and local modification", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = original\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);

    // Overwrite local file to simulate a diverged local state
    await writeFile(configFile, "key = modified\n");

    const result = await ctx.runCli(["status"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Sync status");
    // Repository still has original; pull would restore it
    expect(out).toContain("Pull changes");
    expect(out).toContain("Changed");
  });

  it("reports no push changes after syncing local files to the repository", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = value\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);
    await ctx.runCli(["push"]);

    const result = await ctx.runCli(["status"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Push changes");
    expect(out).toContain("No push changes");
  });

  it("shows entry details with --verbose", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = value\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);

    const result = await ctx.runCli(["status", "--verbose"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Entries:");
    expect(out).toContain("sync dir");
    expect(out).toContain("config");
  });
});
