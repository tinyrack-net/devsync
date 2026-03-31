/**
 * @description
 * Ensures string output can be emitted as a complete newline-terminated line.
 */
export const ensureTrailingNewline = (value: string) => {
  return value.endsWith("\n") ? value : `${value}\n`;
};
