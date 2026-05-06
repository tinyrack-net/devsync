import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { join } from "node:path";
import { exec } from "@yao-pkg/pkg";

const require = createRequire(import.meta.url);

type CommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type CommandResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
};

const builtinSpecifiers = new Set(
  builtinModules.flatMap((entry) =>
    entry.startsWith("node:")
      ? [entry, entry.slice("node:".length)]
      : [entry, `node:${entry}`],
  ),
);

export const isNodeBuiltinSpecifier = (specifier: string): boolean => {
  return builtinSpecifiers.has(specifier);
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

export type PkgBuildOptions = {
  repoRoot: string;
  target?: string;
};

export async function performPkgBuild(options: PkgBuildOptions) {
  const cliDir = join(options.repoRoot, "packages", "cli");
  const distDirectory = join(cliDir, "dist");
  const pkgOutputDirectory = join(distDirectory, "pkg");
  const pkgBundlePath = join(pkgOutputDirectory, "dotweave.bundle.js");

  const isMultiTarget = options.target?.includes(",");
  const isWin =
    !isMultiTarget &&
    (options.target
      ? options.target.includes("win")
      : process.platform === "win32");

  const executablePath = join(
    pkgOutputDirectory,
    isWin ? "dotweave.exe" : "dotweave",
  );

  console.log("Building dist/ output...");
  const tscResult = captureCommand(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.build.json"],
    { cwd: cliDir },
  );

  if (tscResult.exitCode !== 0) {
    throw new Error(
      `TypeScript build failed:\n${tscResult.stdout}\n${tscResult.stderr}`,
    );
  }

  const bundleForPkg = async (): Promise<void> => {
    const { build: viteBuild } = require("vite");
    console.log("Bundling dist/index.js for pkg...");
    await rm(pkgOutputDirectory, { force: true, recursive: true });
    await mkdir(pkgOutputDirectory, { recursive: true });

    await viteBuild({
      appType: "custom",
      root: cliDir,
      build: {
        copyPublicDir: false,
        emptyOutDir: false,
        lib: {
          entry: join(distDirectory, "index.js"),
          fileName: () => "dotweave.bundle.js",
          formats: ["es"],
        },
        minify: false,
        outDir: pkgOutputDirectory,
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
        target: "node24",
      },
      logLevel: "info",
    });

    const bundleSource = await readFile(pkgBundlePath, "utf8");
    validateBundleImports(bundleSource);
    console.log(`pkg bundle written to ${pkgBundlePath}`);
  };

  const validateBundleImports = (bundleSource: string): void => {
    const importPatterns = [
      /^\s*import\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
      /^\s*import\s+["']([^"']+)["'];?$/gm,
      /^\s*export\s+.+?\s+from\s+["']([^"']+)["'];?$/gm,
      /require\(["']([^"']+)["']\)/g,
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
        `pkg bundle still has non-builtin imports: ${[...unexpectedImports]
          .sort()
          .join(", ")}`,
      );
    }
  };

  await bundleForPkg();

  const pkgTarget = options.target || "node24";
  console.log(
    `Generating pkg executable for ${pkgTarget} at ${executablePath}...`,
  );
  await exec([
    "-t",
    pkgTarget,
    pkgBundlePath,
    "-o",
    executablePath,
    "--public",
    "--no-bytecode",
    "--no-signature",
  ]);

  console.log(`pkg executable generated at ${executablePath}`);
}

export async function performPkgSmoke(options: {
  repoRoot: string;
  skipBuild: boolean;
  executablePath?: string;
}) {
  const cliDir = join(options.repoRoot, "packages", "cli");
  const packageJson = JSON.parse(
    await readFile(join(cliDir, "package.json"), "utf8"),
  );
  const pkgDirectory = join(cliDir, "dist", "pkg");
  const executablePath = options.executablePath
    ? join(options.repoRoot, options.executablePath)
    : join(
        pkgDirectory,
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
    result: CommandResult,
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

  const runExecutable = (args: string[]) => {
    return captureCommand(executablePath, args, {
      cwd: options.repoRoot,
      env: smokeEnvironment,
    });
  };

  if (!options.skipBuild) {
    await performPkgBuild({ repoRoot: options.repoRoot });
  }

  const versionResult = runExecutable(["--version"]);
  assertCommandSucceeded("pkg --version", versionResult);
  assertIncludes(
    "pkg --version stdout",
    versionResult.stdout,
    `dotweave/${packageJson.version}`,
  );
  assertEmpty("pkg --version stderr", versionResult.stderr);

  const rootHelpResult = runExecutable([]);
  assertCommandSucceeded("pkg root help", rootHelpResult);
  assertIncludes("pkg root help", rootHelpResult.stdout, "autocomplete");
  assertIncludes("pkg root help", rootHelpResult.stdout, "track");
  assertIncludes("pkg root help", rootHelpResult.stdout, "profile");
  assertEmpty("pkg root help stderr", rootHelpResult.stderr);

  const trackHelpResult = runExecutable(["track", "--help"]);
  assertCommandSucceeded("pkg track --help", trackHelpResult);
  assertIncludes("pkg track --help", trackHelpResult.stdout, "--mode");
  assertIncludes("pkg track --help", trackHelpResult.stdout, "--profile");
  assertEmpty("pkg track --help stderr", trackHelpResult.stderr);

  const profileHelpResult = runExecutable(["profile", "use", "--help"]);
  assertCommandSucceeded("pkg profile use --help", profileHelpResult);
  assertIncludes(
    "pkg profile use --help",
    profileHelpResult.stdout,
    "Profile name to activate",
  );
  assertEmpty("pkg profile use --help stderr", profileHelpResult.stderr);

  const removedCommandResult = runExecutable(["add", "~/.gitconfig"]);

  if (removedCommandResult.exitCode === 0) {
    throw new Error(
      `pkg removed command unexpectedly succeeded.\nstdout:\n${removedCommandResult.stdout}\nstderr:\n${removedCommandResult.stderr}`,
    );
  }

  assertIncludes(
    "pkg removed command stderr",
    removedCommandResult.stderr,
    "not found",
  );

  console.log(`pkg smoke test passed with ${executablePath}`);
}
