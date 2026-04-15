import { createRequire } from "node:module";
import { stripVTControlCharacters } from "node:util";

const require = createRequire(import.meta.url);

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
  const pty = require("node-pty") as typeof import("node-pty");
  const terminal = pty.spawn(options.file, [...(options.args ?? [])], {
    cols: 120,
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      TERM: "xterm-256color",
    },
    name: "xterm-256color",
    rows: 40,
  });

  let output = "";

  terminal.onData((chunk) => {
    output += chunk;
  });

  return {
    clearOutput: () => {
      output = "";
    },
    close: () => {
      terminal.kill();
    },
    getOutput: () => {
      return normalizeTerminalOutput(output);
    },
    waitFor: (pattern, timeoutMs = 5_000) => {
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

        const timeout = setTimeout(() => {
          cleanup();
          reject(
            new Error(
              `Timed out waiting for terminal output matching ${String(pattern)}.\n\n${normalizeTerminalOutput(output)}`,
            ),
          );
        }, timeoutMs);

        const dataListener = () => {
          if (!matches()) {
            return;
          }

          cleanup();
          resolve(normalizeTerminalOutput(output));
        };

        const dataSubscription = terminal.onData(dataListener);

        const cleanup = () => {
          clearTimeout(timeout);
          dataSubscription.dispose();
        };
      });
    },
    write: (value) => {
      terminal.write(value);
    },
  };
};
