export const normalizeWhitespace = (value: string): string => {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const ensureTrailingNewline = (value: string) => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

export const readOptionalString = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === "" ? undefined : trimmedValue;
};

export const readString = (value: Record<string, unknown>, key: string) => {
  const property = value[key];

  return typeof property === "string" ? property : undefined;
};

export const splitTokens = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(/\s+/u)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
};
