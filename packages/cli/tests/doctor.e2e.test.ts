import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

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

describe("doctor CLI e2e", () => {
  it("reports git repository failure before init", async () => {
    const result = await ctx.runCli(["doctor"], { reject: false });

    // consola.fail() routes to stdout (not stderr)
    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("Doctor found issues");
  });

  it("reports warnings after init with no tracked entries", async () => {
    const ageKeys = await ctx.createAgeKeyPair();
    await ctx.writeIdentityFile(ageKeys.identity);
    await ctx.runCli(["init"]);

    const result = await ctx.runCli(["doctor"]);

    expect(result.exitCode).toBe(0);
    // The warning summary goes to stderr; the warning icon lines go to stdout
    expect(stripAnsi(result.stderr)).toContain(
      "Doctor completed with warnings",
    );
    expect(stripAnsi(result.stdout)).toContain("entries");
  });

  it("passes after init with a tracked entry that exists locally", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = value\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);

    const result = await ctx.runCli(["doctor"]);

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("Doctor passed");
  });

  it("does not warn when a tracked path is missing locally but absent from the current sync state", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = value\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configFile]);
    await rm(configFile);

    const result = await ctx.runCli(["doctor"]);
    const out = stripAnsi(result.stdout);
    const err = stripAnsi(result.stderr);

    expect(result.exitCode).toBe(0);
    expect(err).not.toContain("Doctor completed with warnings");
    expect(out).toContain("Doctor passed");
    expect(out).not.toContain("local – 1 tracked local path is missing");
  });

  it("shows detailed check results with --verbose", async () => {
    const configDir = join(ctx.homeDir, ".config", "myapp");
    const configFile = join(configDir, "config.toml");
    const ageKeys = await ctx.createAgeKeyPair();

    await ctx.writeIdentityFile(ageKeys.identity);
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile, "key = value\n");

    await ctx.runCli(["init"]);
    await ctx.runCli(["track", configDir]);

    const result = await ctx.runCli(["doctor", "--verbose"]);

    expect(result.exitCode).toBe(0);
    const out = stripAnsi(result.stdout);
    expect(out).toContain("Doctor passed");
    expect(out).toContain("sync dir");
    expect(out).toContain("config");
  });
});
