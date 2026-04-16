import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSyncE2EContext,
  type SyncE2EContext,
} from "../src/test/helpers/e2e-context.ts";

let ctx: SyncE2EContext;

beforeEach(async () => {
  ctx = await createSyncE2EContext();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe("concurrency e2e", () => {
  it("handles a large number of files during push and pull", async () => {
    const appDirectory = join(ctx.homeDir, "large-app");
    const fileCount = 100;

    await mkdir(appDirectory, { recursive: true });

    const fileNames = Array.from({ length: fileCount }, (_, i) => {
      return `file-${i}.txt`;
    });

    for (const fileName of fileNames) {
      await writeFile(join(appDirectory, fileName), `content for ${fileName}\n`);
    }

    const ageKeys = await ctx.createAgeKeyPair();
    await ctx.writeIdentityFile(ageKeys.identity);

    // Init and track
    await ctx.runCli(["init"]);
    await ctx.runCli(["track", appDirectory]);

    // Push
    const pushResult = await ctx.runCli(["push"]);
    expect(pushResult.exitCode).toBe(0);
    expect(pushResult.stdout).toContain("Push complete");
    expect(pushResult.stdout).toContain(`${fileCount} plain`);

    // Modify some files locally to trigger updates during pull later
    for (let i = 0; i < 20; i += 1) {
      await writeFile(join(appDirectory, fileNames[i]!), `modified content ${i}\n`);
    }

    // Push again (updates)
    const pushUpdateResult = await ctx.runCli(["push"]);
    expect(pushUpdateResult.exitCode).toBe(0);

    // Pull to a fresh location (effectively)
    // We'll delete the local files and pull
    for (const fileName of fileNames) {
      await writeFile(join(appDirectory, fileName), "corrupted\n");
    }

    const pullResult = await ctx.runCli(["pull", "-y"]);
    expect(pullResult.exitCode).toBe(0);

    // Verify all files are restored correctly
    for (let i = 0; i < fileCount; i += 1) {
      const fileName = fileNames[i]!;
      const content = await readFile(join(appDirectory, fileName), "utf8");
      if (i < 20) {
        expect(content).toBe(`modified content ${i}\n`);
      } else {
        expect(content).toBe(`content for ${fileName}\n`);
      }
    }
  });
});
