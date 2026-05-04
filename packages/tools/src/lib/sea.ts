import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
};

type CommandResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
};

export const seaBuilderMinimumVersion = "25.5.0";

const builtinSpecifiers = new Set(
  builtinModules.flatMap((entry) =>
    entry.startsWith("node:")
      ? [entry, entry.slice("node:".length)]
      : [entry, `node:${entry}`],
  ),
);

const parseVersion = (version: string): number[] => {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((segment) => {
      return Number.parseInt(segment, 10);
    });
};

const compareVersions = (left: number[], right: number[]): number => {
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
};

const formatCommand = (command: string, args: string[]): string => {
  return [command, ...args]
    .map((segment) => {
      return /\s/.test(segment) ? JSON.stringify(segment) : segment;
    })
    .join(" ");
};

export const isNodeBuiltinSpecifier = (specifier: string): boolean => {
  return builtinSpecifiers.has(specifier);
};

export const ensureSeaBuilderNode = (): void => {
  if (
    compareVersions(
      parseVersion(process.version),
      parseVersion(seaBuilderMinimumVersion),
    ) < 0
  ) {
    throw new Error(
      `Node.js ${seaBuilderMinimumVersion}+ is required for Node SEA builds. Current runtime: ${process.version}.`,
    );
  }
};

export const runCommand = async (
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: options.stdio ?? "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const outcome =
        signal === null ? `exit code ${code ?? -1}` : `signal ${signal}`;

      reject(
        new Error(`${formatCommand(command, args)} failed with ${outcome}.`),
      );
    });
  });
};

export const captureCommand = (
  command: string,
  args: string[],
  options: CommandOptions = {},
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  return {
    exitCode: result.status ?? -1,
    signal: result.signal ?? null,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
};

export type SeaBuildOptions = {
  repoRoot: string;
  bundleOnly: boolean;
};

export async function performSeaBuild(options: SeaBuildOptions) {
  const cliDir = join(options.repoRoot, "packages", "cli");
  const distDirectory = join(cliDir, "dist");
  const seaDirectory = join(distDirectory, "sea");
  const seaBundlePath = join(seaDirectory, "dotweave.bundle.js");
  const seaConfigPath = join(seaDirectory, "sea-config.json");
  const seaExecutablePath = join(
    seaDirectory,
    process.platform === "win32" ? "dotweave.exe" : "dotweave",
  );
  const tscCliPath = require.resolve("typescript/bin/tsc");

  const buildDistribution = async (): Promise<void> => {
    console.log("Building dist/ output...");
    await runCommand(
      process.execPath,
      [tscCliPath, "-p", "tsconfig.build.json"],
      {
        cwd: cliDir,
      },
    );
  };

  const bundleForSea = async (): Promise<void> => {
    const { build: viteBuild } = require("vite");
    console.log("Bundling dist/index.js for SEA...");
    await rm(seaDirectory, { force: true, recursive: true });
    await mkdir(seaDirectory, { recursive: true });

    await viteBuild({
      appType: "custom",
      root: cliDir,
      build: {
        copyPublicDir: false,
        emptyOutDir: false,
        lib: {
          entry: join(distDirectory, "index.js"),
          fileName: () => "dotweave.bundle",
          formats: ["es"],
        },
        minify: false,
        outDir: seaDirectory,
        reportCompressedSize: false,
        rollupOptions: {
          external: (specifier: string) => {
            return (
              typeof specifier === "string" && isNodeBuiltinSpecifier(specifier)
            );
          },
          output: {
            entryFileNames: "dotweave.bundle.js",
            format: "es",
          },
        },
        sourcemap: false,
        target: "node25",
      },
      logLevel: "info",
    });

    const bundleSource = await readFile(seaBundlePath, "utf8");
    validateBundleImports(bundleSource);
    console.log(`SEA bundle written to ${seaBundlePath}`);
  };

  const validateBundleImports = (bundleSource: string): void => {
    const importPatterns = [
      /^\s*import\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
      /^\s*import\s+["']([^"']+)["'];?$/gm,
      /^\s*export\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
    ];
    const unexpectedImports = new Set<string>();

    for (const pattern of importPatterns) {
      let match = pattern.exec(bundleSource);

      while (match !== null) {
        const specifier = match[1];

        if (specifier === undefined) {
          match = pattern.exec(bundleSource);
          continue;
        }

        if (!isNodeBuiltinSpecifier(specifier)) {
          unexpectedImports.add(specifier);
        }

        match = pattern.exec(bundleSource);
      }
    }

    if (unexpectedImports.size > 0) {
      throw new Error(
        `SEA bundle still has non-builtin imports: ${[...unexpectedImports].sort().join(", ")}`,
      );
    }
  };

  const writeSeaConfig = async (): Promise<void> => {
    const seaConfig = {
      disableExperimentalSEAWarning: true,
      main: seaBundlePath,
      mainFormat: "module" as const,
      output: seaExecutablePath,
      useCodeCache: false,
      useSnapshot: false,
    };

    await writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`);
  };

  const buildSeaExecutable = async (): Promise<void> => {
    ensureSeaBuilderNode();
    console.log(`Generating SEA executable with Node.js ${process.version}...`);
    await rm(seaExecutablePath, { force: true });
    await writeSeaConfig();
    await runCommand(process.execPath, ["--build-sea", seaConfigPath], {
      cwd: options.repoRoot,
    });
    console.log(`SEA executable written to ${seaExecutablePath}`);
  };

  await buildDistribution();
  await bundleForSea();

  if (!options.bundleOnly) {
    await buildSeaExecutable();
  }
}

export async function performSeaSmoke(options: {
  repoRoot: string;
  skipBuild: boolean;
}) {
  const cliDir = join(options.repoRoot, "packages/cli");
  const packageJson = JSON.parse(
    await readFile(join(cliDir, "package.json"), "utf8"),
  );
  const seaDirectory = join(cliDir, "dist/sea");
  const seaExecutablePath = join(
    seaDirectory,
    process.platform === "win32" ? "dotweave.exe" : "dotweave",
  );

  const smokeEnvironment = {
    FORCE_COLOR: "0",
    NODE_NO_WARNINGS: "1",
    NODE_OPTIONS: "",
    NO_COLOR: "1",
  };

  const assertCommandSucceeded = (
    label: string,
    result: ReturnType<typeof captureCommand>,
  ): void => {
    if (result.exitCode === 0) {
      return;
    }

    const signalSuffix =
      result.signal === null ? "" : `, signal: ${result.signal}`;

    throw new Error(
      `${label} failed with exit code ${result.exitCode}${signalSuffix}.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  };

  const assertIncludes = (
    label: string,
    actual: string,
    expected: string,
  ): void => {
    if (actual.includes(expected)) {
      return;
    }

    throw new Error(
      `${label} did not include ${JSON.stringify(expected)}.\nactual output:\n${actual}`,
    );
  };

  const assertEmpty = (label: string, actual: string): void => {
    if (actual === "") {
      return;
    }

    throw new Error(
      `${label} was expected to be empty.\nactual output:\n${actual}`,
    );
  };

  const runSeaExecutable = (args: string[]) => {
    return captureCommand(seaExecutablePath, args, {
      cwd: options.repoRoot,
      env: smokeEnvironment,
    });
  };

  if (!options.skipBuild) {
    await performSeaBuild({ repoRoot: options.repoRoot, bundleOnly: false });
  }

  const versionResult = runSeaExecutable(["--version"]);
  assertCommandSucceeded("SEA --version", versionResult);
  assertIncludes(
    "SEA --version stdout",
    versionResult.stdout,
    `dotweave/${packageJson.version}`,
  );
  assertEmpty("SEA --version stderr", versionResult.stderr);

  const rootHelpResult = runSeaExecutable([]);
  assertCommandSucceeded("SEA root help", rootHelpResult);
  assertIncludes("SEA root help", rootHelpResult.stdout, "autocomplete");
  assertIncludes("SEA root help", rootHelpResult.stdout, "track");
  assertIncludes("SEA root help", rootHelpResult.stdout, "profile");
  assertEmpty("SEA root help stderr", rootHelpResult.stderr);

  const trackHelpResult = runSeaExecutable(["track", "--help"]);
  assertCommandSucceeded("SEA track --help", trackHelpResult);
  assertIncludes("SEA track --help", trackHelpResult.stdout, "--mode");
  assertIncludes("SEA track --help", trackHelpResult.stdout, "--profile");
  assertEmpty("SEA track --help stderr", trackHelpResult.stderr);

  const profileHelpResult = runSeaExecutable(["profile", "use", "--help"]);
  assertCommandSucceeded("SEA profile use --help", profileHelpResult);
  assertIncludes(
    "SEA profile use --help",
    profileHelpResult.stdout,
    "Profile name to activate",
  );
  assertEmpty("SEA profile use --help stderr", profileHelpResult.stderr);

  const removedCommandResult = runSeaExecutable(["add", "~/.gitconfig"]);

  if (removedCommandResult.exitCode === 0) {
    throw new Error(
      `SEA removed command unexpectedly succeeded.\nstdout:\n${removedCommandResult.stdout}\nstderr:\n${removedCommandResult.stderr}`,
    );
  }

  assertIncludes(
    "SEA removed command stderr",
    removedCommandResult.stderr,
    "not found",
  );

  console.log(`SEA smoke test passed with ${seaExecutablePath}`);
}
