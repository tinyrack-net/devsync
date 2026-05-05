import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

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

export type SeaTarget =
  | "bun-linux-x64"
  | "bun-linux-arm64"
  | "bun-darwin-x64"
  | "bun-darwin-arm64"
  | "bun-windows-x64"
  | "bun-windows-arm64";

const formatCommand = (command: string, args: string[]): string => {
  return [command, ...args]
    .map((segment) => {
      return /\s/.test(segment) ? JSON.stringify(segment) : segment;
    })
    .join(" ");
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
  target: SeaTarget | undefined;
  bundleOnly: boolean;
};

export async function performSeaBuild(options: SeaBuildOptions) {
  const cliDir = join(options.repoRoot, "packages", "cli");
  const seaDirectory = join(cliDir, "dist", "sea");
  const entryPoint = join(cliDir, "src", "index.ts");

  const isWindows =
    options.target?.startsWith("bun-windows") ??
    (process.platform === "win32" && !options.target);
  const executableName = isWindows ? "dotweave.exe" : "dotweave";
  const seaExecutablePath = join(seaDirectory, executableName);

  const buildArgs = [
    "build",
    entryPoint,
    "--compile",
    "--minify",
    "--sourcemap",
    "--outfile",
    seaExecutablePath,
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
  ];

  if (options.target) {
    buildArgs.push("--target", options.target);
  }

  await rm(seaExecutablePath, { force: true });
  await mkdir(seaDirectory, { recursive: true });

  console.log(
    `Building SEA executable with bun build --compile${options.target ? ` (target: ${options.target})` : ""}...`,
  );
  await runCommand("bun", buildArgs, {
    cwd: options.repoRoot,
  });
  console.log(`SEA executable written to ${seaExecutablePath}`);
}

export async function performSeaSmoke(options: {
  repoRoot: string;
  skipBuild: boolean;
  target?: SeaTarget;
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

  const smokeEnvironment: Record<string, string> = {
    FORCE_COLOR: "0",
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
    await performSeaBuild({
      repoRoot: options.repoRoot,
      bundleOnly: false,
      target: options.target,
    });
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
