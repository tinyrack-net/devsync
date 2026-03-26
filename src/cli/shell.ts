import { spawn } from "node:child_process";

import type { PlatformKey } from "#app/config/platform.js";
import { detectCurrentPlatformKey } from "#app/config/platform.js";
import { DevsyncError } from "#app/services/error.js";

type ShellCommand = Readonly<{
  args: readonly string[];
  command: string;
}>;
type ShellEnvironment = NodeJS.ProcessEnv & {
  COMSPEC?: string;
  DEVSYNC_CD_ARGS?: string;
  DEVSYNC_CD_COMMAND?: string;
  SHELL?: string;
};

const trimConfiguredValue = (value: string | undefined) => {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const parseShellArgsOverride = (value: string | undefined) => {
  const trimmed = trimConfiguredValue(value);

  if (trimmed === undefined) {
    return [] as const;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new DevsyncError("Invalid DEVSYNC_CD_ARGS value.", {
      details: ["DEVSYNC_CD_ARGS must be valid JSON."],
      hint: 'Use a JSON array of strings, for example: ["-i"]',
    });
  }

  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new DevsyncError("Invalid DEVSYNC_CD_ARGS value.", {
      details: ["DEVSYNC_CD_ARGS must be a JSON array of strings."],
      hint: 'Use a JSON array of strings, for example: ["-i"]',
    });
  }

  return parsed;
};

const resolveShellOverride = (
  environment: NodeJS.ProcessEnv = process.env,
): ShellCommand | undefined => {
  const shellEnvironment = environment as ShellEnvironment;
  const command = trimConfiguredValue(shellEnvironment.DEVSYNC_CD_COMMAND);

  if (command === undefined) {
    return undefined;
  }

  return {
    args: parseShellArgsOverride(shellEnvironment.DEVSYNC_CD_ARGS),
    command,
  };
};

export const resolveShellCommandForPlatform = (
  platformKey: PlatformKey,
  environment: NodeJS.ProcessEnv = process.env,
): ShellCommand => {
  const shellEnvironment = environment as ShellEnvironment;
  const override = resolveShellOverride(environment);

  if (override !== undefined) {
    return override;
  }

  if (platformKey === "win") {
    return {
      args: [],
      command: trimConfiguredValue(shellEnvironment.COMSPEC) ?? "cmd.exe",
    };
  }

  return {
    args: [],
    command: trimConfiguredValue(shellEnvironment.SHELL) ?? "/bin/sh",
  };
};

export const resolveShellCommand = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return resolveShellCommandForPlatform(
    detectCurrentPlatformKey(environment),
    environment,
  );
};

const createShellFailureHint = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return detectCurrentPlatformKey(environment) === "win"
    ? "Set COMSPEC or DEVSYNC_CD_COMMAND to a valid shell executable."
    : "Set SHELL or DEVSYNC_CD_COMMAND to a valid shell executable.";
};

const createShellExitError = (
  command: string,
  code: number | null,
  signal: NodeJS.Signals | null,
) => {
  const error = new DevsyncError(
    signal === null
      ? `Shell exited with code ${code ?? "unknown"}.`
      : `Shell exited due to signal ${signal}.`,
    {
      details: [`Shell: ${command}`],
      hint: "Exit the spawned shell normally when you're done.",
    },
  ) as DevsyncError & { exitCode?: number };

  error.exitCode = code ?? 1;

  return error;
};

export const launchShellInDirectory = async (
  directory: string,
  environment: NodeJS.ProcessEnv = process.env,
) => {
  const { args, command } = resolveShellCommand(environment);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: directory,
      env: environment,
      stdio: "inherit",
    });
    let settled = false;

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      handler();
    };

    child.on("error", (error) => {
      finish(() => {
        reject(
          new DevsyncError("Failed to launch shell.", {
            details: [
              `Shell: ${command}`,
              error instanceof Error ? error.message : String(error),
            ],
            hint: createShellFailureHint(environment),
          }),
        );
      });
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        finish(resolve);

        return;
      }

      finish(() => {
        reject(createShellExitError(command, code, signal));
      });
    });
  });
};
