import { spawn } from "node:child_process";

import type { PlatformKey } from "#app/config/platform.js";
import { detectCurrentPlatformKey } from "#app/config/platform.js";
import { DevsyncError } from "#app/services/error.js";

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
    environment: NodeJS.ProcessEnv,
  ) => Promise<WindowsProcessInfo | undefined>;
}>;

type ShellEnvironment = NodeJS.ProcessEnv & {
  COMSPEC?: string;
  DEVSYNC_CD_ARGS?: string;
  DEVSYNC_CD_COMMAND?: string;
  SHELL?: string;
};

const windowsShellNames = new Set([
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

const inspectWindowsProcess = async (
  processId: number,
  environment: NodeJS.ProcessEnv,
) => {
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
        env: environment,
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

const resolveWindowsShellCommand = async (
  environment: NodeJS.ProcessEnv,
  options: ResolveShellCommandOptions,
): Promise<ShellCommand> => {
  const shellEnvironment = environment as ShellEnvironment;
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

    const processInfo = await inspect(processId, environment);

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
    command: trimConfiguredValue(shellEnvironment.COMSPEC) ?? "cmd.exe",
  };
};

export const resolveShellCommandForPlatform = async (
  platformKey: PlatformKey,
  environment: NodeJS.ProcessEnv = process.env,
  options: ResolveShellCommandOptions = {},
): Promise<ShellCommand> => {
  const shellEnvironment = environment as ShellEnvironment;
  const override = resolveShellOverride(environment);

  if (override !== undefined) {
    return override;
  }

  if (platformKey === "win") {
    return await resolveWindowsShellCommand(environment, options);
  }

  return {
    args: [],
    command: trimConfiguredValue(shellEnvironment.SHELL) ?? "/bin/sh",
  };
};

export const resolveShellCommand = async (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return await resolveShellCommandForPlatform(
    detectCurrentPlatformKey(environment),
    environment,
  );
};

const createShellFailureHint = (
  environment: NodeJS.ProcessEnv = process.env,
) => {
  return detectCurrentPlatformKey(environment) === "win"
    ? "Set DEVSYNC_CD_COMMAND or COMSPEC to a valid shell executable."
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
  const { args, command } = await resolveShellCommand(environment);

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
