import { realpathSync } from "node:fs";
import { stripVTControlCharacters } from "node:util";

const applyBackspaces = (value: string) => {
  let result = "";

  for (const character of value) {
    if (character === "\b") {
      result = result.slice(0, -1);
      continue;
    }

    result += character;
  }

  return result;
};

const normalizeTerminalOutput = (value: string) => {
  return applyBackspaces(stripVTControlCharacters(value))
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n");
};

export type PtySession = Readonly<{
  clearOutput: () => void;
  close: () => void;
  getOutput: () => string;
  waitFor: (pattern: RegExp | string, timeoutMs?: number) => Promise<string>;
  write: (value: string) => void;
}>;

export const createPtySession = (options: {
  args?: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string | undefined>>;
  file: string;
}): PtySession => {
  const cleanEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries({
    ...process.env,
    ...options.env,
  })) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }

  let output = "";

  let dataListeners: Array<() => void> = [];

  const proc = Bun.spawn([options.file, ...(options.args ?? [])], {
    cwd: realpathSync(options.cwd),
    env: {
      ...cleanEnv,
      TERM: "xterm-256color",
    },
    terminal: {
      cols: 120,
      rows: 40,
      data(_terminal, data) {
        output += data;

        for (const listener of dataListeners) {
          listener();
        }
      },
    },
  });

  return {
    clearOutput: () => {
      output = "";
    },
    close: () => {
      proc.terminal?.close();
      proc.kill();
    },
    getOutput: () => {
      return normalizeTerminalOutput(output);
    },
    waitFor: (pattern, timeoutMs = 10_000) => {
      return new Promise((resolve, reject) => {
        const matches = () => {
          const normalizedOutput = normalizeTerminalOutput(output);

          return typeof pattern === "string"
            ? normalizedOutput.includes(pattern)
            : pattern.test(normalizedOutput);
        };

        if (matches()) {
          resolve(normalizeTerminalOutput(output));
          return;
        }

        const listener = () => {
          if (!matches()) {
            return;
          }

          cleanup();
          resolve(normalizeTerminalOutput(output));
        };

        dataListeners = [...dataListeners, listener];

        const timeout = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `Timed out waiting for terminal output matching ${String(pattern)}.\n\n${normalizeTerminalOutput(output)}`,
            ),
          );
        }, timeoutMs);

        const cleanup = () => {
          clearTimeout(timeout);
          dataListeners = dataListeners.filter((l) => l !== listener);
        };
      });
    },
    write: (value) => {
      proc.terminal?.write(value);
    },
  };
};
