export const ensureTrailingNewline = (value: string) => {
  return value.endsWith("\n") ? value : `${value}\n`;
};
