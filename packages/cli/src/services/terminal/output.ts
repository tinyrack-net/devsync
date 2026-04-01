import { ensureTrailingNewline } from "#app/lib/string.ts";

export type OutputLine = false | null | string | undefined;

const compactLines = (lines: readonly OutputLine[]) => {
  return lines.filter((line): line is string => {
    return line !== undefined && line !== null && line !== false;
  });
};

export const output = (...lines: readonly OutputLine[]) => {
  return ensureTrailingNewline(compactLines(lines).join("\n"));
};

export const writeStdout = (value: string) => {
  process.stdout.write(value);
};

export const writeStderr = (value: string) => {
  process.stderr.write(value);
};
