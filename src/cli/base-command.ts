import { Command } from "@oclif/core";

import {
  formatErrorMessage,
  writeStderr,
  writeStdout,
} from "#app/lib/output.ts";

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

  protected printError(message: string) {
    writeStderr(formatErrorMessage(message));
  }

  public override async catch(error: CommandError): Promise<unknown> {
    if (error instanceof Error) {
      this.printError(error.message);
      this.exit(resolveExitCode(error));

      return;
    }

    return super.catch(error);
  }
}
