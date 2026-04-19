export type DotweaveErrorOptions = Readonly<{
  code?: string;
  details?: readonly string[];
  hint?: string;
}>;

/**
 * @description
 * Removes empty lines before error details are rendered or stored.
 */
const compactLines = (lines: readonly (string | undefined)[]) => {
  return lines.filter((line): line is string => {
    return typeof line === "string" && line.trim().length > 0;
  });
};

export class DotweaveError extends Error {
  public readonly code?: string;
  public readonly details: readonly string[];
  public readonly hint?: string;

  public constructor(message: string, options: DotweaveErrorOptions = {}) {
    super(message);
    this.name = "DotweaveError";
    this.code = options.code;
    this.details = options.details ?? [];
    this.hint = options.hint;
  }
}

/**
 * @description
 * Renders supported error values into the user-facing dotweave error format.
 */
export const formatDotweaveError = (error: DotweaveError | Error | string) => {
  if (typeof error === "string") {
    return error;
  }

  if (!(error instanceof DotweaveError)) {
    return error.message;
  }

  return compactLines([
    error.message,
    ...error.details,
    error.hint === undefined ? undefined : `Hint: ${error.hint}`,
  ]).join("\n");
};

/**
 * @description
 * Wraps unknown failures in a DotweaveError with normalized detail lines.
 */
export const wrapUnknownError = (
  message: string,
  error: unknown,
  options: DotweaveErrorOptions = {},
) => {
  const detail = error instanceof Error ? error.message.trim() : String(error);

  return new DotweaveError(message, {
    ...options,
    details: compactLines([...(options.details ?? []), detail]),
  });
};
