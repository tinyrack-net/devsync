import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import packageJson from "../package.json" with { type: "json" };
import {
  gitTestEnvironment,
  stripAnsi,
} from "../src/test/helpers/sync-fixture.ts";

const cliPackageRoot = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(cliPackageRoot, "bin", "index.js");

interface BinEntryContext {
  baseEnv: NodeJS.ProcessEnv;
  homeDir: string;
  workspace: string;
  xdgDir: string;
}

const createBinEntryContext = async (): Promise<BinEntryContext> => {
  const workspace = await mkdtemp(join(tmpdir(), "dotweave-bin-"));
  const homeDir = join(workspace, "home");
  const xdgDir = join(workspace, "xdg");
  const localAppDataDir = join(workspace, "local-appdata");

  await mkdir(homeDir, { recursive: true });

  return {
    baseEnv: {
      APPDATA: xdgDir,
      FORCE_COLOR: "0",
      HOME: homeDir,
      LOCALAPPDATA: localAppDataDir,
      NODE_NO_WARNINGS: "1",
      NO_COLOR: "1",
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: xdgDir,
      ...gitTestEnvironment,
    },
    homeDir,
    workspace,
    xdgDir,
  };
};

const runBin = async (
  args: readonly string[],
  options?: Readonly<{
    env?: NodeJS.ProcessEnv;
    reject?: boolean;
  }>,
) => {
  return execa(process.execPath, [binPath, ...args], {
    cwd: cliPackageRoot,
    env: options?.env,
    reject: options?.reject ?? true,
  });
};

describe("built bin entrypoint e2e", () => {
  let ctx: BinEntryContext;

  beforeEach(async () => {
    ctx = await createBinEntryContext();
  });

  afterEach(async () => {
    await rm(ctx.workspace, { force: true, recursive: true });
  });

  it("shows the package version through bin/index.js", async () => {
    const result = await runBin(["--version"], { env: ctx.baseEnv });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`dotweave/${packageJson.version}`);
    expect(result.stderr).toBe("");
  });

  it("shows root help through bin/index.js", async () => {
    const result = await runBin(["--help"], { env: ctx.baseEnv });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const out = stripAnsi(result.stdout);
    expect(out).toContain("USAGE");
    expect(out).toContain("init");
    expect(out).toContain("track");
    expect(out).toContain("push");
    expect(out).toContain("pull");
    expect(out).toContain("status");
    expect(out).toContain("doctor");
    expect(out).toContain("profile");
  });

  it("runs a minimal init flow through bin/index.js", async () => {
    const result = await runBin(["init"], { env: ctx.baseEnv });

    expect(result.exitCode).toBe(0);
    expect(stripAnsi(result.stdout)).toContain("Sync directory initialized");
    expect(
      JSON.parse(
        await readFile(join(ctx.xdgDir, "dotweave", "settings.jsonc"), "utf8"),
      ),
    ).toMatchObject({
      activeProfile: "default",
      version: 3,
    });
    expect(
      JSON.parse(
        await readFile(
          join(ctx.xdgDir, "dotweave", "repository", "manifest.jsonc"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      entries: [],
      version: 8,
    });
  });
});
