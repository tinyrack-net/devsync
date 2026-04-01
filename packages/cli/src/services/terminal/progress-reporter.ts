import type { ProgressReporter } from "#app/lib/progress.ts";
import { createCliLogger } from "./logger.ts";

export const createCliProgressReporter = (
  options: Readonly<{
    verbose?: boolean;
  }> = {},
): ProgressReporter => {
  const verbose = options.verbose ?? false;
  const logger = createCliLogger({
    stderr: process.stderr,
    stdout: process.stderr,
    verbose,
  });

  return {
    detail: (message: string) => {
      if (!verbose) {
        return;
      }

      logger.verbose(message);
    },
    phase: (message: string) => {
      if (!verbose) {
        return;
      }

      logger.start(message);
    },
    verbose,
  };
};
