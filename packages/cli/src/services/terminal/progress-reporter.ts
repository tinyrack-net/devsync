import { formatProgressMessage, writeStderr } from "#app/lib/output.ts";
import type { ProgressReporter } from "#app/lib/progress.ts";

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
