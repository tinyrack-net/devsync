import { Command, Flags } from "@oclif/core";

import { createCliProgressReporter } from "#app/cli/progress-reporter.js";
import {
  formatErrorMessage,
  writeStderr,
  writeStdout,
} from "#app/lib/output.js";
import type { ProgressReporter } from "#app/lib/progress.js";
import { formatDevsyncError } from "#app/services/error.js";

type CommandError = Error & {
  exitCode?: number;
  oclif?: {
    exit?: number;
  };
};

const resolveExitCode = (error: CommandError) => {
  return error.oclif?.exit ?? error.exitCode ?? 1;
};

export abstract class BaseCommand extends Command {
  public static override baseFlags = {
    verbose: Flags.boolean({
      default: false,
      summary: "Show detailed output including file paths and progress details",
    }),
  };

  protected print(output: string) {
    writeStdout(output);
  }

  protected printError(message: Error | string) {
    writeStderr(formatErrorMessage(message));
  }

  protected createProgressReporter(verbose = false): ProgressReporter {
    return createCliProgressReporter({ verbose });
  }

  public override async catch(error: CommandError): Promise<unknown> {
    if (error instanceof Error) {
      this.printError(formatDevsyncError(error));
      this.exit(resolveExitCode(error));
    }

    return super.catch(error);
  }
}
