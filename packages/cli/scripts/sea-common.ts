import { spawn, spawnSync } from "node:child_process";
import { builtinModules, createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const tscCliPath = require.resolve("typescript/bin/tsc");
export const distDirectory = join(repositoryRoot, "dist");
export const seaDirectory = join(distDirectory, "sea");
export const seaBundlePath = join(seaDirectory, "devsync.bundle.js");
export const seaConfigPath = join(seaDirectory, "sea-config.json");
export const seaExecutablePath = join(
  seaDirectory,
  process.platform === "win32" ? "devsync.exe" : "devsync",
);

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
      cwd: options.cwd ?? repositoryRoot,
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

export const runNodeScript = async (
  scriptPath: string,
  args: string[] = [],
  options: CommandOptions = {},
): Promise<void> => {
  await runCommand(process.execPath, [scriptPath, ...args], options);
};

export const captureCommand = (
  command: string,
  args: string[],
  options: CommandOptions = {},
): CommandResult => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
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
