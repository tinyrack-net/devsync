import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

const packageRoot = fileURLToPath(new URL("../../../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const buildLockDirectory = join(repositoryRoot, ".tmp", "cli-build-lock");
const requiredBuildArtifacts = [
  join(packageRoot, "dist", "index.js"),
  join(packageRoot, "dist", "application.js"),
  join(packageRoot, "dist", "cli", "untrack.js"),
] as const;

export const cliPath = fileURLToPath(
  new URL("../../../src/index.ts", import.meta.url),
);

let buildPromise: Promise<void> | undefined;

const delay = async (milliseconds: number) => {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const isBuildReady = async () => {
  const checks = await Promise.allSettled(
    requiredBuildArtifacts.map(async (artifactPath) => {
      await stat(artifactPath);
    }),
  );

  return checks.every((result) => result.status === "fulfilled");
};

const waitForOtherWorkerBuild = async () => {
  while (true) {
    if (await isBuildReady()) {
      return;
    }

    try {
      await stat(buildLockDirectory);
    } catch {
      return;
    }

    await delay(100);
  }
};

const ensureCliBuiltOnce = async () => {
  if (await isBuildReady()) {
    return;
  }

  await mkdir(join(repositoryRoot, ".tmp"), { recursive: true });

  while (true) {
    try {
      await mkdir(buildLockDirectory);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        await waitForOtherWorkerBuild();

        if (await isBuildReady()) {
          return;
        }

        continue;
      }

      throw error;
    }

    try {
      if (await isBuildReady()) {
        return;
      }

      await execa(npmCommand, ["run", "build"], {
        cwd: repositoryRoot,
      });

      return;
    } finally {
      await rm(buildLockDirectory, { force: true, recursive: true });
    }
  }
};

export const ensureCliBuilt = async () => {
  buildPromise ??= ensureCliBuiltOnce();

  await buildPromise;
};
