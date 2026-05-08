import { spawn } from "node:child_process";

import type { PlatformKey } from "#app/config/platform.ts";
import { resolveCurrentPlatformKey } from "#app/config/runtime-env.ts";
import { ENV } from "#app/lib/env.ts";
import { DotweaveError } from "#app/lib/error.ts";
import { trimConfiguredValue } from "#app/lib/string.ts";

type ShellCommand = Readonly<{
  args: readonly string[];
  command: string;
}>;

export const resolveShellCommandForPlatform = async (
  platformKey: PlatformKey,
): Promise<ShellCommand> => {
  if (platformKey === "win") {
    return { args: [], command: trimConfiguredValue(ENV.COMSPEC) ?? "cmd.exe" };
  }

  return { args: [], command: trimConfiguredValue(ENV.SHELL) ?? "/bin/sh" };
};

export const resolveShellCommand = async () => {
  return await resolveShellCommandForPlatform(resolveCurrentPlatformKey());
};

const createShellFailureHint = () => {
  return resolveCurrentPlatformKey() === "win"
    ? "Set COMSPEC to a valid shell executable."
    : "Set SHELL to a valid shell executable.";
};

const createShellExitError = (
  command: string,
  code: number | null,
  signal: NodeJS.Signals | null,
) => {
  const error = new DotweaveError(
    signal === null
      ? `Shell exited with code ${code ?? "unknown"}.`
      : `Shell exited due to signal ${signal}.`,
    {
      details: [`Shell: ${command}`],
      hint: "Exit the spawned shell normally when you're done.",
    },
  ) as DotweaveError & { exitCode?: number };

  error.exitCode = code ?? 1;

  return error;
};

export const launchShellInDirectory = async (directory: string) => {
  const { args, command } = await resolveShellCommand();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: directory,
      env: process.env,
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
          new DotweaveError("Failed to launch shell.", {
            details: [
              `Shell: ${command}`,
              error instanceof Error ? error.message : String(error),
            ],
            hint: createShellFailureHint(),
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
