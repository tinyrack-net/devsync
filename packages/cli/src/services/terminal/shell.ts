import { spawn } from "node:child_process";

import type { PlatformKey } from "#app/config/platform.ts";
import { resolveCurrentPlatformKey } from "#app/config/runtime-env.ts";
import { ENV } from "#app/lib/env.ts";
import { DotweaveError } from "#app/lib/error.ts";

type ShellCommand = Readonly<{
  args: readonly string[];
  command: string;
}>;

type WindowsProcessInfo = Readonly<{
  commandLine?: string;
  executablePath?: string;
  name?: string;
  parentProcessId: number;
  processId: number;
}>;

type ResolveShellCommandOptions = Readonly<{
  initialWindowsProcessId?: number;
  inspectWindowsProcess?: (
    processId: number,
  ) => Promise<WindowsProcessInfo | undefined>;
}>;

const windowsShellNames = new Set<string>([
  "bash",
  "cmd",
  "fish",
  "nu",
  "powershell",
  "pwsh",
  "sh",
  "zsh",
]);

const windowsProcessQueryScript = [
  "$processId = [int]$args[0]",
  '$process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $processId)',
  "if ($null -eq $process) { exit 0 }",
  "$encode = {",
  "  param([string]$value)",
  '  if ([string]::IsNullOrEmpty($value)) { return "" }',
  "  return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($value))",
  "}",
  "[Console]::Out.WriteLine($process.ProcessId)",
  "[Console]::Out.WriteLine($process.ParentProcessId)",
  "[Console]::Out.WriteLine((& $encode $process.Name))",
  "[Console]::Out.WriteLine((& $encode $process.ExecutablePath))",
  "[Console]::Out.WriteLine((& $encode $process.CommandLine))",
].join(";");

const trimConfiguredValue = (value: string | undefined) => {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const decodeWindowsProcessField = (value: string | undefined) => {
  const trimmed = trimConfiguredValue(value);

  if (trimmed === undefined) {
    return undefined;
  }

  return Buffer.from(trimmed, "base64").toString("utf8");
};

const normalizeProcessName = (value: string | undefined) => {
  const trimmed = trimConfiguredValue(value);

  if (trimmed === undefined) {
    return undefined;
  }

  const filename = trimmed
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.toLowerCase();

  if (filename === undefined || filename === "") {
    return undefined;
  }

  return filename.endsWith(".exe") ? filename.slice(0, -4) : filename;
};

const stripSingleTrailingLineEnding = (value: string) => {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }

  return value;
};

const parseWindowsProcessInfo = (
  output: string,
): WindowsProcessInfo | undefined => {
  const normalized = stripSingleTrailingLineEnding(output);

  if (normalized === "") {
    return undefined;
  }

  const lines = normalized.split(/\r?\n/u);

  if (lines.length < 5) {
    return undefined;
  }

  const [
    processIdLine,
    parentProcessIdLine,
    nameValue,
    executablePathValue,
    commandLineValue,
  ] = lines;
  const processId = Number.parseInt(processIdLine ?? "", 10);
  const parentProcessId = Number.parseInt(parentProcessIdLine ?? "", 10);

  if (
    !Number.isSafeInteger(processId) ||
    processId <= 0 ||
    !Number.isSafeInteger(parentProcessId) ||
    parentProcessId < 0
  ) {
    return undefined;
  }

  return {
    commandLine: decodeWindowsProcessField(commandLineValue),
    executablePath: decodeWindowsProcessField(executablePathValue),
    name: decodeWindowsProcessField(nameValue),
    parentProcessId,
    processId,
  };
};

const inspectWindowsProcess = async (processId: number) => {
  return await new Promise<WindowsProcessInfo | undefined>((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        windowsProcessQueryScript,
        String(processId),
      ],
      {
        env: process.env,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      },
    );
    let stdout = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.on("error", () => {
      resolve(undefined);
    });

    child.on("close", (code) => {
      resolve(code === 0 ? parseWindowsProcessInfo(stdout) : undefined);
    });
  });
};

const isWrapperCmdProcess = (processInfo: WindowsProcessInfo) => {
  return /(?:^|\s)\/c(?:\s|$)/iu.test(processInfo.commandLine ?? "");
};

const createShellCommandFromProcess = (
  processInfo: WindowsProcessInfo,
): ShellCommand | undefined => {
  const command =
    trimConfiguredValue(processInfo.executablePath) ??
    trimConfiguredValue(processInfo.name);
  const processName = normalizeProcessName(command);

  if (
    command === undefined ||
    processName === undefined ||
    !windowsShellNames.has(processName)
  ) {
    return undefined;
  }

  if (processName === "cmd" && isWrapperCmdProcess(processInfo)) {
    return undefined;
  }

  return {
    args: [],
    command,
  };
};

const resolveWindowsShellCommand = async (
  options: ResolveShellCommandOptions,
): Promise<ShellCommand> => {
  const inspect = options.inspectWindowsProcess ?? inspectWindowsProcess;
  const visited = new Set<number>();
  let processId = options.initialWindowsProcessId ?? process.ppid;

  while (
    Number.isSafeInteger(processId) &&
    processId > 0 &&
    !visited.has(processId) &&
    visited.size < 16
  ) {
    visited.add(processId);

    const processInfo = await inspect(processId);

    if (processInfo === undefined) {
      break;
    }

    const shellCommand = createShellCommandFromProcess(processInfo);

    if (shellCommand !== undefined) {
      return shellCommand;
    }

    processId = processInfo.parentProcessId;
  }

  return {
    args: [],
    command: trimConfiguredValue(ENV.COMSPEC) ?? "cmd.exe",
  };
};

export const resolveShellCommandForPlatform = async (
  platformKey: PlatformKey,
  options: ResolveShellCommandOptions = {},
): Promise<ShellCommand> => {
  if (platformKey === "win") {
    return await resolveWindowsShellCommand(options);
  }

  return {
    args: [],
    command: trimConfiguredValue(ENV.SHELL) ?? "/bin/sh",
  };
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
