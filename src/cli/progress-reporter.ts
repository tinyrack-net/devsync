import { formatProgressMessage, writeStderr } from "#app/lib/output.js";
import type { ProgressReporter } from "#app/lib/progress.js";

export const createCliProgressReporter = (
  options: Readonly<{
    verbose?: boolean;
  }> = {},
): ProgressReporter => {
  const verbose = options.verbose ?? false;

  return {
    detail: (message: string) => {
      if (!verbose) {
        return;
      }

      writeStderr(formatProgressMessage(message, { detail: true }));
    },
    phase: (message: string) => {
      writeStderr(formatProgressMessage(message));
    },
    verbose,
  };
};
