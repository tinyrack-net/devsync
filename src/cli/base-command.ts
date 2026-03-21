import { Command } from "@oclif/core";

import {
  formatErrorMessage,
  writeStderr,
  writeStdout,
} from "#app/lib/output.ts";
import { formatDevsyncError } from "#app/services/error.ts";

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
  protected print(output: string) {
    writeStdout(output);
  }

  protected printError(message: Error | string) {
    writeStderr(formatErrorMessage(message));
  }

  public override async catch(error: CommandError): Promise<unknown> {
    if (error instanceof Error) {
      this.printError(formatDevsyncError(error));
      this.exit(resolveExitCode(error));
    }

    return super.catch(error);
  }
}
